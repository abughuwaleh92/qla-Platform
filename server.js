const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
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
const fs = require('fs').promises;
require('dotenv').config();

// ============================================
// INITIALIZE EXPRESS APP
// ============================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://qla.up.railway.app', 'http://localhost:3000'],
    credentials: true
  }
});

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const config = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET?.trim() || 'qla-lms-secret-' + Date.now(),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID?.trim(),
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET?.trim(),
  CLIENT_URL: process.env.CLIENT_URL?.trim() || 'https://qla.up.railway.app',
  ALLOWED_EMAIL_DOMAIN: process.env.ALLOWED_EMAIL_DOMAIN?.trim() || '@qla.qfschools.qa',
  PASS_PERCENTAGE: parseInt(process.env.PASS_PERCENTAGE) || 70,
  ASSESSMENT_TIME_LIMIT: parseInt(process.env.ASSESSMENT_TIME_LIMIT) || 15,
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 104857600
};

// ============================================
// DATABASE CONNECTION
// ============================================
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.connect()
  .then(client => {
    console.log('✅ Database connected successfully');
    client.release();
  })
  .catch(err => {
    console.error('❌ Database connection error:', err.message);
  });

// ============================================
// CREATE REQUIRED TABLES
// ============================================
async function initializeDatabase() {
  try {
    // Create session table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      ) WITH (OIDS=FALSE);
      
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    // Create all required tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        profile_picture TEXT,
        role VARCHAR(50) DEFAULT 'student',
        grade INTEGER DEFAULT 7,
        bio TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        grade INTEGER NOT NULL,
        unit INTEGER NOT NULL,
        lesson_order INTEGER DEFAULT 0,
        content TEXT,
        html_content TEXT,
        video_url TEXT,
        practice_problems JSONB DEFAULT '[]',
        assessment_questions JSONB DEFAULT '[]',
        interactive_elements JSONB DEFAULT '[]',
        teacher_id INTEGER REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'published',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lesson_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        progress INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        video_progress INTEGER DEFAULT 0,
        slide_progress JSONB DEFAULT '{}',
        interactions_completed JSONB DEFAULT '[]',
        completed BOOLEAN DEFAULT FALSE,
        last_accessed TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, lesson_id)
      );

      CREATE TABLE IF NOT EXISTS assessments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        score INTEGER,
        total_points INTEGER,
        percentage INTEGER,
        passed BOOLEAN DEFAULT FALSE,
        time_taken INTEGER,
        answers JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS question_bank (
        id SERIAL PRIMARY KEY,
        grade INTEGER NOT NULL,
        unit INTEGER,
        topic VARCHAR(255),
        question_type VARCHAR(50),
        question TEXT NOT NULL,
        options JSONB,
        correct_answer JSONB,
        explanation TEXT,
        difficulty VARCHAR(20),
        points INTEGER DEFAULT 10,
        tags JSONB DEFAULT '[]',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS classroom_sessions (
        id SERIAL PRIMARY KEY,
        session_code VARCHAR(10) UNIQUE,
        teacher_id INTEGER REFERENCES users(id),
        lesson_id INTEGER REFERENCES lessons(id),
        current_slide INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        students JSONB DEFAULT '[]',
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS skills (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        grade INTEGER,
        difficulty VARCHAR(50),
        due_date DATE,
        teacher_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS skill_assignments (
        id SERIAL PRIMARY KEY,
        skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(50) DEFAULT 'assigned',
        progress INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(skill_id, user_id)
      );
    `);

    console.log('✅ All database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

// Initialize database tables
initializeDatabase();

// ============================================
// CREATE REQUIRED DIRECTORIES
// ============================================
async function createRequiredDirs() {
  const dirs = [
    'uploads',
    'public',
    'public/lessons',
    'public/lessons/grade7',
    'public/lessons/grade8',
    'public/assets'
  ];
  
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`✅ Directory ready: ${dir}`);
    } catch (error) {
      console.error(`❌ Error creating directory ${dir}:`, error.message);
    }
  }
}
createRequiredDirs();

// ============================================
// MIDDLEWARE CONFIGURATION
// ============================================
app.set('trust proxy', 1);

// Security middleware with proper CSP for interactive lessons
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:", "*.googleusercontent.com"],
      connectSrc: ["'self'", "https://accounts.google.com", "wss://qla.up.railway.app", "ws://localhost:3000"],
      frameSrc: ["'self'", "https://accounts.google.com", "https://www.youtube.com", "https://player.vimeo.com"]
    }
  }
}));

app.use(compression());
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://qla.up.railway.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// IMPORTANT: Serve static files with correct paths
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lessons', express.static(path.join(__dirname, 'public', 'lessons')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================
// SESSION CONFIGURATION
// ============================================
const sessionStore = new pgSession({
  pool: pool,
  tableName: 'session',
  createTableIfMissing: true,
  pruneSessionInterval: 60 * 15,
  ttl: 24 * 60 * 60
});

app.use(session({
  store: sessionStore,
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: config.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax'
  },
  name: 'qla.sid',
  proxy: true
}));

app.use(passport.initialize());
app.use(passport.session());

// ============================================
// RATE LIMITING
// ============================================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again later.',
  skipSuccessfulRequests: true
});

app.use('/api/', generalLimiter);
app.use('/auth/', authLimiter);

// ============================================
// FILE UPLOAD CONFIGURATION
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|mp4|webm|ogg|mp3|wav|doc|docx|ppt|pptx|xls|xlsx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// ============================================
// GOOGLE OAUTH CONFIGURATION
// ============================================
if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    callbackURL: config.NODE_ENV === 'production'
      ? 'https://qla.up.railway.app/auth/google/callback'
      : 'http://localhost:3000/auth/google/callback',
    proxy: true,
    passReqToCallback: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      
      if (!email) {
        return done(null, false, { message: 'No email found' });
      }

      // Check email domain in production
      if (config.NODE_ENV === 'production' && !email.endsWith(config.ALLOWED_EMAIL_DOMAIN)) {
        return done(null, false, { message: `Only ${config.ALLOWED_EMAIL_DOMAIN} emails allowed` });
      }

      // Check if user exists
      let result = await pool.query(
        'SELECT * FROM users WHERE google_id = $1 OR email = $2',
        [profile.id, email]
      );
      
      let user;
      
      if (result.rows.length === 0) {
        // Create new user
        const role = email.includes('teacher') || email.includes('staff') || email.includes('admin') 
          ? 'teacher' 
          : 'student';
        
        const createResult = await pool.query(
          `INSERT INTO users (google_id, email, name, profile_picture, role, grade, created_at, last_login)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           RETURNING *`,
          [
            profile.id,
            email,
            profile.displayName || 'User',
            profile.photos?.[0]?.value,
            role,
            role === 'student' ? 7 : null
          ]
        );
        
        user = createResult.rows[0];
      } else {
        // Update existing user
        user = result.rows[0];
        
        await pool.query(
          'UPDATE users SET last_login = NOW() WHERE id = $1',
          [user.id]
        );
      }

      return done(null, user);
    } catch (error) {
      console.error('OAuth Strategy Error:', error);
      return done(error, null);
    }
  }));
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0]);
  } catch (error) {
    done(error, null);
  }
});

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
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

// ============================================
// AUTHENTICATION ROUTES
// ============================================
app.get('/auth/google', (req, res, next) => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google OAuth not configured');
  }
  
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) {
      console.error('OAuth Callback Error:', err);
      return res.redirect(`/login-failed?error=${encodeURIComponent(err.message)}`);
    }
    
    if (!user) {
      const message = info?.message || 'Authentication failed';
      return res.redirect(`/login-failed?error=${encodeURIComponent(message)}`);
    }
    
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('Login Error:', loginErr);
        return res.redirect(`/login-failed?error=${encodeURIComponent('Login failed')}`);
      }
      
      res.redirect('/');
    });
  })(req, res, next);
});

app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      res.redirect('/');
    });
  });
});

// ============================================
// API ROUTES
// ============================================

// Auth status
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

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbCheck.rows.length > 0 ? 'connected' : 'error'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Lessons API - Enhanced for interactive features
app.get('/api/lessons', isAuthenticated, async (req, res) => {
  try {
    const { grade, unit, status } = req.query;
    let query = `
      SELECT l.*, u.name as teacher_name,
        COUNT(DISTINCT lp.user_id) as student_count,
        COALESCE(AVG(lp.progress), 0)::integer as avg_progress
      FROM lessons l
      LEFT JOIN users u ON l.teacher_id = u.id
      LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;

    if (grade) {
      query += ` AND l.grade = $${paramIndex}`;
      params.push(parseInt(grade));
      paramIndex++;
    }
    if (unit) {
      query += ` AND l.unit = $${paramIndex}`;
      params.push(parseInt(unit));
      paramIndex++;
    }
    if (status) {
      query += ` AND l.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Students only see published lessons
    if (req.user.role === 'student') {
      query += ` AND l.status = 'published'`;
    }

    query += ' GROUP BY l.id, u.name ORDER BY l.grade, l.unit, l.lesson_order';
    
    const result = await pool.query(query, params);
    
    // Add user progress for students
    if (req.user.role === 'student' && result.rows.length > 0) {
      const lessonIds = result.rows.map(l => l.id);
      const progressResult = await pool.query(
        'SELECT * FROM lesson_progress WHERE user_id = $1 AND lesson_id = ANY($2::int[])',
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
    
    res.json(result.rows);
  } catch (error) {
    console.error('Lessons error:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

app.get('/api/lessons/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, u.name as teacher_name
       FROM lessons l
       LEFT JOIN users u ON l.teacher_id = u.id
       WHERE l.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const lesson = result.rows[0];

    // Get user progress if student
    if (req.user.role === 'student') {
      const progress = await pool.query(
        'SELECT * FROM lesson_progress WHERE lesson_id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      lesson.user_progress = progress.rows[0] || null;
    }

    res.json(lesson);
  } catch (error) {
    console.error('Lesson error:', error);
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

// Enhanced progress tracking for interactive lessons
app.post('/api/progress/lesson', isStudent, async (req, res) => {
  try {
    const { 
      lesson_id, 
      progress, 
      time_spent, 
      video_progress, 
      slide_progress,
      interactions_completed,
      completed 
    } = req.body;

    const result = await pool.query(
      `INSERT INTO lesson_progress (
        user_id, lesson_id, progress, time_spent,
        video_progress, slide_progress, interactions_completed,
        completed, last_accessed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (user_id, lesson_id)
      DO UPDATE SET
        progress = GREATEST(lesson_progress.progress, $3),
        time_spent = lesson_progress.time_spent + $4,
        video_progress = GREATEST(lesson_progress.video_progress, $5),
        slide_progress = $6::jsonb,
        interactions_completed = $7::jsonb,
        completed = $8 OR lesson_progress.completed,
        last_accessed = NOW()
      RETURNING *`,
      [
        req.user.id,
        lesson_id,
        progress || 0,
        time_spent || 0,
        video_progress || 0,
        JSON.stringify(slide_progress || {}),
        JSON.stringify(interactions_completed || []),
        completed || false
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Interactive lesson activity tracking
app.post('/api/lessons/:id/interaction', isStudent, async (req, res) => {
  try {
    const { interaction_type, interaction_data, correct } = req.body;
    const lesson_id = req.params.id;
    
    // Log the interaction
    await pool.query(
      `INSERT INTO lesson_interactions 
       (user_id, lesson_id, interaction_type, interaction_data, correct, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [req.user.id, lesson_id, interaction_type, interaction_data, correct]
    );
    
    // Update progress based on interaction
    const progressUpdate = correct ? 10 : 5; // Award more progress for correct answers
    
    await pool.query(
      `UPDATE lesson_progress 
       SET progress = LEAST(progress + $1, 100),
           interactions_completed = interactions_completed || $2::jsonb
       WHERE user_id = $3 AND lesson_id = $4`,
      [progressUpdate, JSON.stringify([interaction_data]), req.user.id, lesson_id]
    );
    
    res.json({ success: true, progress_added: progressUpdate });
  } catch (error) {
    console.error('Interaction tracking error:', error);
    res.status(500).json({ error: 'Failed to track interaction' });
  }
});

// Question Bank Routes
app.get('/api/question-bank', isTeacher, async (req, res) => {
  try {
    const { grade, unit, topic, difficulty, question_type } = req.query;
    let query = 'SELECT * FROM question_bank WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (grade) {
      query += ` AND grade = $${paramIndex}`;
      params.push(parseInt(grade));
      paramIndex++;
    }
    if (unit) {
      query += ` AND unit = $${paramIndex}`;
      params.push(parseInt(unit));
      paramIndex++;
    }
    if (topic) {
      query += ` AND topic ILIKE $${paramIndex}`;
      params.push(`%${topic}%`);
      paramIndex++;
    }
    if (difficulty) {
      query += ` AND difficulty = $${paramIndex}`;
      params.push(difficulty);
      paramIndex++;
    }
    if (question_type) {
      query += ` AND question_type = $${paramIndex}`;
      params.push(question_type);
      paramIndex++;
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Question bank error:', error);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

app.post('/api/question-bank', isTeacher, async (req, res) => {
  try {
    const {
      grade, unit, topic, question_type,
      question, options, correct_answer,
      explanation, difficulty, points, tags
    } = req.body;
    
    const result = await pool.query(
      `INSERT INTO question_bank 
       (grade, unit, topic, question_type, question, options, 
        correct_answer, explanation, difficulty, points, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        grade, unit, topic, question_type, question,
        JSON.stringify(options), JSON.stringify(correct_answer),
        explanation, difficulty, points || 10,
        JSON.stringify(tags || []), req.user.id
      ]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Question creation error:', error);
    res.status(500).json({ error: 'Failed to create question' });
  }
});

// Classroom Session Routes for Live Teaching
app.post('/api/classroom/start', isTeacher, async (req, res) => {
  try {
    const { lesson_id } = req.body;
    const session_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const result = await pool.query(
      `INSERT INTO classroom_sessions 
       (session_code, teacher_id, lesson_id, current_slide, is_active, started_at)
       VALUES ($1, $2, $3, 0, true, NOW())
       RETURNING *`,
      [session_code, req.user.id, lesson_id]
    );
    
    // Emit to WebSocket
    io.emit('classroom-started', {
      session_code,
      lesson_id,
      teacher: req.user.name
    });
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Classroom session error:', error);
    res.status(500).json({ error: 'Failed to start classroom session' });
  }
});

app.post('/api/classroom/join', isStudent, async (req, res) => {
  try {
    const { session_code } = req.body;
    
    const session = await pool.query(
      'SELECT * FROM classroom_sessions WHERE session_code = $1 AND is_active = true',
      [session_code]
    );
    
    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or inactive' });
    }
    
    // Add student to session
    const students = session.rows[0].students || [];
    if (!students.find(s => s.id === req.user.id)) {
      students.push({
        id: req.user.id,
        name: req.user.name,
        joined_at: new Date()
      });
      
      await pool.query(
        'UPDATE classroom_sessions SET students = $1 WHERE id = $2',
        [JSON.stringify(students), session.rows[0].id]
      );
    }
    
    // Emit to WebSocket
    io.to(`classroom-${session_code}`).emit('student-joined', {
      student: req.user.name,
      total_students: students.length
    });
    
    res.json({
      session: session.rows[0],
      lesson_id: session.rows[0].lesson_id
    });
  } catch (error) {
    console.error('Join classroom error:', error);
    res.status(500).json({ error: 'Failed to join classroom' });
  }
});

app.post('/api/classroom/:session_code/control', isTeacher, async (req, res) => {
  try {
    const { action, data } = req.body;
    const { session_code } = req.params;
    
    let updateQuery = '';
    let updateParams = [];
    
    switch(action) {
      case 'next_slide':
        updateQuery = 'UPDATE classroom_sessions SET current_slide = current_slide + 1 WHERE session_code = $1';
        updateParams = [session_code];
        break;
      case 'prev_slide':
        updateQuery = 'UPDATE classroom_sessions SET current_slide = GREATEST(current_slide - 1, 0) WHERE session_code = $1';
        updateParams = [session_code];
        break;
      case 'go_to_slide':
        updateQuery = 'UPDATE classroom_sessions SET current_slide = $2 WHERE session_code = $1';
        updateParams = [session_code, data.slide_number];
        break;
      case 'end_session':
        updateQuery = 'UPDATE classroom_sessions SET is_active = false, ended_at = NOW() WHERE session_code = $1';
        updateParams = [session_code];
        break;
    }
    
    if (updateQuery) {
      await pool.query(updateQuery, updateParams);
      
      // Emit control action to all students
      io.to(`classroom-${session_code}`).emit('classroom-control', {
        action,
        data
      });
      
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Classroom control error:', error);
    res.status(500).json({ error: 'Failed to control classroom' });
  }
});

// Assessment submission with automatic grading
app.post('/api/assessments/submit', isStudent, async (req, res) => {
  try {
    const { lesson_id, answers, time_taken } = req.body;

    // Get assessment questions
    const lessonResult = await pool.query(
      'SELECT assessment_questions FROM lessons WHERE id = $1',
      [lesson_id]
    );

    if (lessonResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const questions = lessonResult.rows[0].assessment_questions || [];
    if (questions.length === 0) {
      return res.status(400).json({ error: 'No assessment questions' });
    }

    // Calculate score
    let score = 0;
    let totalPoints = 0;
    const results = [];

    questions.forEach((question, index) => {
      const points = question.points || 10;
      totalPoints += points;
      const isCorrect = answers[index] === question.correct;
      if (isCorrect) score += points;
      
      results.push({
        question: question.question,
        user_answer: answers[index],
        correct_answer: question.correct,
        is_correct: isCorrect,
        points: isCorrect ? points : 0
      });
    });

    const percentage = Math.round((score / totalPoints) * 100);
    const passed = percentage >= config.PASS_PERCENTAGE;

    // Save assessment
    const result = await pool.query(
      `INSERT INTO assessments (
        user_id, lesson_id, score, total_points,
        percentage, passed, time_taken, answers, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *`,
      [req.user.id, lesson_id, score, totalPoints, percentage, passed, time_taken, results]
    );

    // Update progress if passed
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
      passed,
      pass_percentage: config.PASS_PERCENTAGE
    });
  } catch (error) {
    console.error('Assessment error:', error);
    res.status(500).json({ error: 'Failed to submit assessment' });
  }
});

// Progress Overview
app.get('/api/progress/overview', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' && req.query.student_id
      ? req.query.student_id
      : req.user.id;
    
    const result = await pool.query(
      `SELECT 
        COUNT(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed = true) as completed_lessons,
        COUNT(DISTINCT l.id) as total_lessons,
        COALESCE(SUM(lp.time_spent), 0) as total_study_time,
        COALESCE(AVG(a.percentage), 0)::integer as average_score,
        COUNT(DISTINCT DATE(lp.last_accessed)) as study_days
      FROM lessons l
      LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $1
      LEFT JOIN assessments a ON a.user_id = $1
      WHERE l.status = 'published'`,
      [userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Progress overview error:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Skills Management
app.get('/api/skills', isAuthenticated, async (req, res) => {
  try {
    let query, params;

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
        WHERE s.teacher_id = $1
        GROUP BY s.id, u.name
        ORDER BY s.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Skills error:', error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// Analytics for Teachers
app.get('/api/analytics/class', isTeacher, async (req, res) => {
  try {
    const { grade } = req.query;
    
    let query = `
      SELECT 
        COUNT(DISTINCT u.id) as total_students,
        COALESCE(AVG(lp.progress), 0)::integer as avg_progress,
        COALESCE(SUM(lp.time_spent), 0) as total_study_time,
        COUNT(DISTINCT lp.lesson_id) as lessons_accessed,
        COALESCE(AVG(a.percentage), 0)::integer as avg_assessment_score
      FROM users u
      LEFT JOIN lesson_progress lp ON u.id = lp.user_id
      LEFT JOIN assessments a ON u.id = a.user_id
      WHERE u.role = 'student'
    `;
    
    const params = [];
    if (grade) {
      query += ' AND u.grade = $1';
      params.push(parseInt(grade));
    }

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

app.get('/api/analytics/students', isTeacher, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.grade,
        COUNT(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed = true) as completed_lessons,
        COALESCE(AVG(lp.progress), 0)::integer as avg_progress,
        COALESCE(SUM(lp.time_spent), 0) as total_study_time,
        COALESCE(AVG(a.percentage), 0)::integer as avg_score,
        MAX(lp.last_accessed) as last_active
      FROM users u
      LEFT JOIN lesson_progress lp ON u.id = lp.user_id
      LEFT JOIN assessments a ON u.id = a.user_id
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY avg_progress DESC NULLS LAST`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Student analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// ============================================
// WEBSOCKET HANDLERS - Enhanced for classroom
// ============================================
io.on('connection', (socket) => {
  console.log('🔌 WebSocket connected:', socket.id);

  socket.on('join-lesson', (lessonId) => {
    socket.join(`lesson-${lessonId}`);
    console.log(`Socket ${socket.id} joined lesson ${lessonId}`);
  });

  socket.on('join-classroom', (sessionCode) => {
    socket.join(`classroom-${sessionCode}`);
    console.log(`Socket ${socket.id} joined classroom ${sessionCode}`);
  });

  socket.on('lesson-interaction', (data) => {
    // Broadcast interaction to teacher in real-time
    io.to(`lesson-${data.lessonId}`).emit('student-interaction', {
      studentId: data.studentId,
      interaction: data.interaction,
      timestamp: new Date()
    });
  });

  socket.on('lesson-progress', (data) => {
    socket.to(`lesson-${data.lessonId}`).emit('student-progress', data);
  });

  socket.on('question-asked', (data) => {
    io.to(`lesson-${data.lessonId}`).emit('new-question', data);
  });

  socket.on('classroom-response', (data) => {
    // Student response in live classroom
    io.to(`classroom-${data.sessionCode}`).emit('student-response', {
      studentId: data.studentId,
      response: data.response,
      timestamp: new Date()
    });
  });

  socket.on('disconnect', () => {
    console.log('🔌 WebSocket disconnected:', socket.id);
  });
});

// ============================================
// CHECK AND SYNC LESSON FILES WITH DATABASE
// ============================================
async function syncLessonFiles() {
  try {
    console.log('📚 Syncing lesson files with database...');
    
    const grades = [7, 8];
    
    for (const grade of grades) {
      const lessonDir = path.join(__dirname, 'public', 'lessons', `grade${grade}`);
      
      try {
        const files = await fs.readdir(lessonDir);
        
        for (const file of files) {
          if (file.endsWith('.html')) {
            // Parse filename to get unit and lesson_order
            const match = file.match(/lesson-(\d+)-(\d+)\.html/);
            if (match) {
              const unit = parseInt(match[1]);
              const lesson_order = parseInt(match[2]);
              
              // Check if lesson exists in database
              const existing = await pool.query(
                'SELECT id FROM lessons WHERE grade = $1 AND unit = $2 AND lesson_order = $3',
                [grade, unit, lesson_order]
              );
              
              if (existing.rows.length === 0) {
                // Read file content
                const filePath = path.join(lessonDir, file);
                const htmlContent = await fs.readFile(filePath, 'utf8');
                
                // Extract title from HTML if possible
                const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
                const title = titleMatch ? titleMatch[1] : `Grade ${grade} - Unit ${unit} - Lesson ${lesson_order}`;
                
                // Insert lesson into database
                await pool.query(
                  `INSERT INTO lessons (title, grade, unit, lesson_order, html_content, status, created_at)
                   VALUES ($1, $2, $3, $4, $5, 'published', NOW())`,
                  [title, grade, unit, lesson_order, htmlContent]
                );
                
                console.log(`✅ Synced lesson file: ${file}`);
              }
            }
          }
        }
      } catch (err) {
        console.log(`📁 Creating grade ${grade} lessons directory...`);
        await fs.mkdir(lessonDir, { recursive: true });
      }
    }
    
    console.log('✅ Lesson sync complete');
  } catch (error) {
    console.error('❌ Lesson sync error:', error);
  }
}

// Run sync on startup
syncLessonFiles();

// ============================================
// SERVE LESSON FILES DIRECTLY
// ============================================
app.get('/api/lesson-file/:grade/:unit/:order', async (req, res) => {
  try {
    const { grade, unit, order } = req.params;
    const filename = `lesson-${unit}-${order}.html`;
    const filepath = path.join(__dirname, 'public', 'lessons', `grade${grade}`, filename);
    
    // Check if file exists
    try {
      await fs.access(filepath);
      res.sendFile(filepath);
    } catch {
      // Try to get from database
      const result = await pool.query(
        'SELECT html_content FROM lessons WHERE grade = $1 AND unit = $2 AND lesson_order = $3',
        [grade, unit, order]
      );
      
      if (result.rows.length > 0 && result.rows[0].html_content) {
        res.send(result.rows[0].html_content);
      } else {
        res.status(404).json({ error: 'Lesson file not found' });
      }
    }
  } catch (error) {
    console.error('Lesson file error:', error);
    res.status(500).json({ error: 'Failed to load lesson file' });
  }
});

// ============================================
// STATIC FILES & FALLBACK
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// ERROR HANDLING
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large' });
  }
  
  res.status(500).json({
    error: config.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : err.message
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = config.PORT;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     🚀 QLA Mathematics LMS Server                         ║
║                                                            ║
║     Environment:  ${config.NODE_ENV.padEnd(40)}║
║     Port:         ${String(PORT).padEnd(40)}║
║     URL:          ${config.CLIENT_URL.padEnd(40)}║
║     Database:     ${config.DATABASE_URL ? '✅ Connected'.padEnd(40) : '❌ Not configured'.padEnd(40)}║
║     Google OAuth: ${config.GOOGLE_CLIENT_ID ? '✅ Configured'.padEnd(40) : '❌ Not configured'.padEnd(40)}║
║                                                            ║
║     Interactive Features: ✅ Enabled                      ║
║     Classroom Mode: ✅ Ready                              ║
║     Question Bank: ✅ Active                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ HTTP server closed');
    pool.end(() => {
      console.log('✅ Database pool closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ HTTP server closed');
    pool.end(() => {
      console.log('✅ Database pool closed');
      process.exit(0);
    });
  });
});

module.exports = app;
