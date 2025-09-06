const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'https://qla.up.railway.app',
    credentials: true
  }
});

// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================
const CONFIG = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'production',
  CLIENT_URL: process.env.CLIENT_URL || 'https://qla.up.railway.app',
  
  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '467065313104-kl7djsf94og0lhll04fnt958jcq79v0q.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: 'https://qla.up.railway.app/auth/google/callback',
  
  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'qla-lms-secret-key-change-this-in-production-2024',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL,
  
  // Application
  ALLOWED_EMAIL_DOMAIN: process.env.ALLOWED_EMAIL_DOMAIN || '@qla.qfschools.qa',
  PASS_PERCENTAGE: parseInt(process.env.PASS_PERCENTAGE) || 70,
  ASSESSMENT_TIME_LIMIT: parseInt(process.env.ASSESSMENT_TIME_LIMIT) || 15,
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 104857600 // 100MB
};

// ==========================================
// DATABASE CONNECTION
// ==========================================
const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl: CONFIG.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error connecting to database:', err.stack);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
  }
});

// ==========================================
// MIDDLEWARE CONFIGURATION
// ==========================================

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:", "*.googleusercontent.com"],
      connectSrc: ["'self'", "https://accounts.google.com", "https://qla.up.railway.app", "wss://qla.up.railway.app"],
      frameSrc: ["'self'", "https://accounts.google.com", "https://www.youtube.com", "https://player.vimeo.com"]
    }
  }
}));

app.use(compression());

// CORS configuration
app.use(cors({
  origin: [CONFIG.CLIENT_URL, 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Session configuration with better production settings
const sessionConfig = {
  secret: CONFIG.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'qla.sid',
  cookie: {
    secure: CONFIG.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: CONFIG.NODE_ENV === 'production' ? 'none' : 'lax'
  }
};

// For Railway/production with PostgreSQL session store
if (CONFIG.NODE_ENV === 'production' && CONFIG.DATABASE_URL) {
  const pgSession = require('connect-pg-simple')(session);
  sessionConfig.store = new pgSession({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  });
}

app.use(session(sessionConfig));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again later.'
});
app.use('/auth/', authLimiter);

// ==========================================
// GOOGLE OAUTH CONFIGURATION
// ==========================================
passport.use(new GoogleStrategy({
  clientID: CONFIG.GOOGLE_CLIENT_ID,
  clientSecret: CONFIG.GOOGLE_CLIENT_SECRET,
  callbackURL: CONFIG.GOOGLE_CALLBACK_URL,
  proxy: true
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('🔍 Google OAuth callback triggered');
    console.log('Profile:', { id: profile.id, email: profile.emails[0]?.value });
    
    const email = profile.emails[0]?.value;
    
    if (!email) {
      console.error('❌ No email found in Google profile');
      return done(null, false, { message: 'No email found' });
    }

    // Check if email is from QLA domain
    if (!email.endsWith(CONFIG.ALLOWED_EMAIL_DOMAIN) && CONFIG.NODE_ENV === 'production') {
      console.log(`❌ Email ${email} not from allowed domain ${CONFIG.ALLOWED_EMAIL_DOMAIN}`);
      return done(null, false, { message: 'Only QLA email addresses are allowed' });
    }

    // Check if user exists
    let user = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
    
    if (user.rows.length === 0) {
      console.log('📝 Creating new user...');
      // Determine role based on email
      const role = email.includes('teacher') || email.includes('staff') || email.includes('admin') ? 'teacher' : 'student';
      
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (google_id, email, name, profile_picture, role, grade, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
         RETURNING *`,
        [
          profile.id,
          email,
          profile.displayName || profile.name?.givenName + ' ' + profile.name?.familyName || email.split('@')[0],
          profile.photos?.[0]?.value || null,
          role,
          role === 'student' ? 7 : null
        ]
      );
      user = result;
      console.log('✅ New user created:', email);
    } else {
      console.log('✅ Existing user found:', email);
      // Update last login
      await pool.query(
        'UPDATE users SET last_login = NOW(), profile_picture = $1 WHERE google_id = $2',
        [profile.photos?.[0]?.value || user.rows[0].profile_picture, profile.id]
      );
    }

    return done(null, user.rows[0]);
  } catch (error) {
    console.error('❌ Google OAuth error:', error);
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, user.rows[0]);
  } catch (error) {
    done(error, null);
  }
});

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
    res.status(401).json({ error: 'Not authenticated' });
  } else {
    res.redirect('/');
  }
};

const isTeacher = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'teacher') {
    return next();
  }
  res.status(403).json({ error: 'Teacher access required' });
};

const isStudent = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'student') {
    return next();
  }
  res.status(403).json({ error: 'Student access required' });
};

// ==========================================
// FILE UPLOAD CONFIGURATION
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: CONFIG.MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|mp4|webm|ogg|mp3|wav|doc|docx|ppt|pptx|xls|xlsx|html/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================
app.get('/auth/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { 
    failureRedirect: '/?error=auth_failed',
    successRedirect: '/',
    failureMessage: true
  }),
  (req, res) => {
    console.log('✅ Authentication successful, redirecting to dashboard');
    res.redirect('/');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Error logging out' });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      res.redirect('/');
    });
  });
});

app.get('/api/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      authenticated: true, 
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        grade: req.user.grade,
        profile_picture: req.user.profile_picture
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ==========================================
// API ROUTES
// ==========================================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: CONFIG.NODE_ENV,
    app_url: CONFIG.CLIENT_URL
  });
});

// User Profile Routes
app.get('/api/users/profile', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*, 
              COUNT(DISTINCT lp.lesson_id) as completed_lessons,
              COALESCE(SUM(lp.time_spent), 0) as total_study_time,
              COALESCE(AVG(a.percentage), 0) as average_score
       FROM users u
       LEFT JOIN lesson_progress lp ON u.id = lp.user_id AND lp.completed = true
       LEFT JOIN assessments a ON u.id = a.user_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/profile', isAuthenticated, async (req, res) => {
  try {
    const { name, grade, bio } = req.body;
    const result = await pool.query(
      'UPDATE users SET name = $1, grade = $2, bio = $3 WHERE id = $4 RETURNING *',
      [name, grade, bio, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Lesson Routes
app.get('/api/lessons', isAuthenticated, async (req, res) => {
  try {
    const { grade, unit, status } = req.query;
    let query = `
      SELECT l.*, u.name as teacher_name,
             COUNT(DISTINCT lp.user_id) as student_count,
             COALESCE(AVG(lp.progress), 0) as avg_progress
      FROM lessons l
      LEFT JOIN users u ON l.teacher_id = u.id
      LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (grade) {
      query += ` AND l.grade = $${paramCount}`;
      params.push(grade);
      paramCount++;
    }
    if (unit) {
      query += ` AND l.unit = $${paramCount}`;
      params.push(unit);
      paramCount++;
    }
    if (status) {
      query += ` AND l.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    } else {
      // Default to showing only published lessons to students
      if (req.user.role === 'student') {
        query += ` AND l.status = 'published'`;
      }
    }

    query += ' GROUP BY l.id, u.name ORDER BY l.grade, l.unit, l.lesson_order';
    
    const result = await pool.query(query, params);
    
    // Add user progress for each lesson if user is a student
    if (req.user.role === 'student') {
      const lessonIds = result.rows.map(l => l.id);
      if (lessonIds.length > 0) {
        const progressResult = await pool.query(
          'SELECT * FROM lesson_progress WHERE user_id = $1 AND lesson_id = ANY($2)',
          [req.user.id, lessonIds]
        );
        
        const progressMap = {};
        progressResult.rows.forEach(p => {
          progressMap[p.lesson_id] = p;
        });
        
        result.rows.forEach(lesson => {
          lesson.user_progress = progressMap[lesson.id] || null;
        });
      }
    }
    
    res.json(result.rows);
  } catch (error) {
    console.error('Lessons fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/lessons/:id', isAuthenticated, async (req, res) => {
  try {
    const lesson = await pool.query(
      `SELECT l.*, u.name as teacher_name
       FROM lessons l
       LEFT JOIN users u ON l.teacher_id = u.id
       WHERE l.id = $1`,
      [req.params.id]
    );

    if (lesson.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Get user's progress for this lesson
    if (req.user.role === 'student') {
      const progress = await pool.query(
        'SELECT * FROM lesson_progress WHERE lesson_id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      lesson.rows[0].user_progress = progress.rows[0] || null;
    }

    res.json(lesson.rows[0]);
  } catch (error) {
    console.error('Lesson fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/lessons', isTeacher, upload.single('video'), async (req, res) => {
  try {
    const {
      title, grade, unit, lesson_order, content,
      practice_problems, assessment_questions,
      interactive_elements, video_url
    } = req.body;

    const videoPath = req.file ? `/uploads/${req.file.filename}` : video_url;

    const result = await pool.query(
      `INSERT INTO lessons (
        title, grade, unit, lesson_order, content,
        practice_problems, assessment_questions,
        interactive_elements, video_url, teacher_id,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *`,
      [
        title, grade, unit, lesson_order || 0, content,
        practice_problems ? JSON.parse(practice_problems) : [],
        assessment_questions ? JSON.parse(assessment_questions) : [],
        interactive_elements ? JSON.parse(interactive_elements) : [],
        videoPath, req.user.id, 'draft'
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Lesson creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/lessons/:id', isTeacher, upload.single('video'), async (req, res) => {
  try {
    const {
      title, grade, unit, lesson_order, content,
      practice_problems, assessment_questions,
      interactive_elements, video_url, status
    } = req.body;

    const videoPath = req.file ? `/uploads/${req.file.filename}` : video_url;

    const result = await pool.query(
      `UPDATE lessons SET
        title = $1, grade = $2, unit = $3, lesson_order = $4,
        content = $5, practice_problems = $6, assessment_questions = $7,
        interactive_elements = $8, video_url = $9, status = $10,
        updated_at = NOW()
      WHERE id = $11 AND teacher_id = $12
      RETURNING *`,
      [
        title, grade, unit, lesson_order || 0, content,
        practice_problems ? JSON.parse(practice_problems) : [],
        assessment_questions ? JSON.parse(assessment_questions) : [],
        interactive_elements ? JSON.parse(interactive_elements) : [],
        videoPath, status, req.params.id, req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found or unauthorized' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Lesson update error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/lessons/:id', isTeacher, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM lessons WHERE id = $1 AND teacher_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found or unauthorized' });
    }

    res.json({ message: 'Lesson deleted successfully' });
  } catch (error) {
    console.error('Lesson deletion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Progress Tracking
app.post('/api/progress/lesson', isStudent, async (req, res) => {
  try {
    const { lesson_id, progress, time_spent, video_progress, completed } = req.body;

    const result = await pool.query(
      `INSERT INTO lesson_progress (
        user_id, lesson_id, progress, time_spent,
        video_progress, completed, last_accessed
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id, lesson_id)
      DO UPDATE SET
        progress = GREATEST(lesson_progress.progress, $3),
        time_spent = lesson_progress.time_spent + $4,
        video_progress = GREATEST(lesson_progress.video_progress, $5),
        completed = $6 OR lesson_progress.completed,
        last_accessed = NOW()
      RETURNING *`,
      [req.user.id, lesson_id, progress || 0, time_spent || 0, video_progress || 0, completed || false]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Progress update error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/progress/overview', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' && req.query.student_id ? req.query.student_id : req.user.id;
    
    const progress = await pool.query(
      `SELECT 
        COUNT(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed = true) as completed_lessons,
        COUNT(DISTINCT l.id) as total_lessons,
        COALESCE(SUM(lp.time_spent), 0) as total_study_time,
        COALESCE(AVG(a.percentage), 0) as average_score,
        COUNT(DISTINCT DATE(lp.last_accessed)) as study_days
      FROM lessons l
      LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $1
      LEFT JOIN assessments a ON a.user_id = $1
      WHERE l.status = 'published'`,
      [userId]
    );

    res.json(progress.rows[0]);
  } catch (error) {
    console.error('Progress overview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Assessment Routes
app.post('/api/assessments/submit', isStudent, async (req, res) => {
  try {
    const { lesson_id, answers, time_taken } = req.body;

    // Get lesson assessment questions
    const lesson = await pool.query(
      'SELECT assessment_questions FROM lessons WHERE id = $1',
      [lesson_id]
    );

    if (lesson.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const questions = lesson.rows[0].assessment_questions || [];
    let score = 0;
    let totalPoints = 0;
    const results = [];

    // Calculate score
    questions.forEach((question, index) => {
      const points = question.points || 10;
      totalPoints += points;
      const correct = answers[index] === question.correct;
      if (correct) score += points;
      results.push({
        question: question.question,
        user_answer: answers[index],
        correct_answer: question.correct,
        is_correct: correct,
        points: correct ? points : 0
      });
    });

    const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
    const passed = percentage >= CONFIG.PASS_PERCENTAGE;

    // Save assessment result
    const result = await pool.query(
      `INSERT INTO assessments (
        user_id, lesson_id, score, total_points,
        percentage, passed, time_taken, answers, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *`,
      [req.user.id, lesson_id, score, totalPoints, percentage, passed, time_taken, results]
    );

    // Update lesson progress if passed
    if (passed) {
      await pool.query(
        `UPDATE lesson_progress 
         SET completed = true, progress = 100
         WHERE user_id = $1 AND lesson_id = $2`,
        [req.user.id, lesson_id]
      );
    }

    res.json({
      ...result.rows[0],
      results,
      passed
    });
  } catch (error) {
    console.error('Assessment submission error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assessments/history', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' && req.query.student_id ? req.query.student_id : req.user.id;
    
    const assessments = await pool.query(
      `SELECT a.*, l.title as lesson_title
       FROM assessments a
       JOIN lessons l ON a.lesson_id = l.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json(assessments.rows);
  } catch (error) {
    console.error('Assessment history error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Skills Routes
app.get('/api/skills', isAuthenticated, async (req, res) => {
  try {
    let query;
    let params = [];

    if (req.user.role === 'student') {
      query = `
        SELECT s.*, u.name as teacher_name, sa.status, sa.progress
        FROM skills s
        LEFT JOIN users u ON s.teacher_id = u.id
        JOIN skill_assignments sa ON s.id = sa.skill_id
        WHERE sa.user_id = $1
        ORDER BY s.created_at DESC
      `;
      params = [req.user.id];
    } else {
      query = `
        SELECT s.*, u.name as teacher_name,
               COUNT(DISTINCT sa.user_id) as assigned_count
        FROM skills s
        LEFT JOIN users u ON s.teacher_id = u.id
        LEFT JOIN skill_assignments sa ON s.id = sa.skill_id
        GROUP BY s.id, u.name
        ORDER BY s.created_at DESC
      `;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Skills fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/skills', isTeacher, async (req, res) => {
  try {
    const { name, description, grade, difficulty, due_date } = req.body;

    const result = await pool.query(
      `INSERT INTO skills (
        name, description, grade, difficulty,
        due_date, teacher_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *`,
      [name, description, grade, difficulty, due_date, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Skill creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/skills/:id/assign', isTeacher, async (req, res) => {
  try {
    const { student_ids } = req.body;
    const skill_id = req.params.id;

    const assignments = await Promise.all(
      student_ids.map(student_id =>
        pool.query(
          `INSERT INTO skill_assignments (skill_id, user_id, assigned_at, status)
           VALUES ($1, $2, NOW(), 'assigned')
           ON CONFLICT (skill_id, user_id) DO NOTHING
           RETURNING *`,
          [skill_id, student_id]
        )
      )
    );

    res.json({ 
      message: 'Skills assigned successfully',
      assigned_count: assignments.filter(a => a.rows.length > 0).length
    });
  } catch (error) {
    console.error('Skill assignment error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/skills/:id/progress', isStudent, async (req, res) => {
  try {
    const { progress, status } = req.body;

    const result = await pool.query(
      `UPDATE skill_assignments
       SET progress = $1, status = $2, updated_at = NOW()
       WHERE skill_id = $3 AND user_id = $4
       RETURNING *`,
      [progress, status, req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill assignment not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Skill progress update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analytics Routes
app.get('/api/analytics/class', isTeacher, async (req, res) => {
  try {
    const { grade, date_from, date_to } = req.query;
    let query = `
      SELECT 
        COUNT(DISTINCT u.id) as total_students,
        COALESCE(AVG(lp.progress), 0) as avg_progress,
        COALESCE(SUM(lp.time_spent), 0) as total_study_time,
        COUNT(DISTINCT lp.lesson_id) as lessons_accessed,
        COALESCE(AVG(a.percentage), 0) as avg_assessment_score
      FROM users u
      LEFT JOIN lesson_progress lp ON u.id = lp.user_id
      LEFT JOIN assessments a ON u.id = a.user_id
      WHERE u.role = 'student'
    `;
    
    const params = [];
    let paramCount = 1;

    if (grade) {
      query += ` AND u.grade = $${paramCount}`;
      params.push(grade);
      paramCount++;
    }
    if (date_from) {
      query += ` AND lp.last_accessed >= $${paramCount}`;
      params.push(date_from);
      paramCount++;
    }
    if (date_to) {
      query += ` AND lp.last_accessed <= $${paramCount}`;
      params.push(date_to);
      paramCount++;
    }

    const analytics = await pool.query(query, params);
    res.json(analytics.rows[0]);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/students', isTeacher, async (req, res) => {
  try {
    const students = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.grade,
        COUNT(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed = true) as completed_lessons,
        COALESCE(AVG(lp.progress), 0) as avg_progress,
        COALESCE(SUM(lp.time_spent), 0) as total_study_time,
        COALESCE(AVG(a.percentage), 0) as avg_score,
        MAX(lp.last_accessed) as last_active
      FROM users u
      LEFT JOIN lesson_progress lp ON u.id = lp.user_id
      LEFT JOIN assessments a ON u.id = a.user_id
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY avg_progress DESC NULLS LAST`
    );

    res.json(students.rows);
  } catch (error) {
    console.error('Student analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket for real-time features
io.on('connection', (socket) => {
  console.log('New WebSocket connection:', socket.id);

  socket.on('join-lesson', (lessonId) => {
    socket.join(`lesson-${lessonId}`);
    console.log(`Socket ${socket.id} joined lesson-${lessonId}`);
  });

  socket.on('lesson-progress', (data) => {
    socket.to(`lesson-${data.lessonId}`).emit('student-progress', data);
  });

  socket.on('question-asked', (data) => {
    io.to(`lesson-${data.lessonId}`).emit('new-question', data);
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected:', socket.id);
  });
});

// ==========================================
// SERVE STATIC FILES & FALLBACK
// ==========================================

// Serve index.html for all non-API routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// ERROR HANDLING
// ==========================================
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    error: CONFIG.NODE_ENV === 'production' 
      ? 'Something went wrong!' 
      : err.message,
    stack: CONFIG.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = CONFIG.PORT;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
    ============================================
    🚀 QLA LMS Server Started Successfully!
    ============================================
    📍 Environment: ${CONFIG.NODE_ENV}
    🌐 Server URL: ${CONFIG.CLIENT_URL}
    🔌 Port: ${PORT}
    🔐 Google OAuth: ${CONFIG.GOOGLE_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}
    💾 Database: ${CONFIG.DATABASE_URL ? '✅ Connected' : '❌ Not connected'}
    📧 Domain: ${CONFIG.ALLOWED_EMAIL_DOMAIN}
    ============================================
  `);
});

module.exports = app;
