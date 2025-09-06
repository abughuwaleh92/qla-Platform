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
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
  }
});

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.vimeo.com", "https://www.youtube.com"],
      frameSrc: ["'self'", "https://www.youtube.com", "https://player.vimeo.com"]
    }
  }
}));
app.use(compression());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'qla-lms-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// File upload configuration
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
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

// Google OAuth configuration
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Check if email is from qla.qfschools.qa domain
    const email = profile.emails[0].value;
    if (!email.endsWith('@qla.qfschools.qa') && process.env.NODE_ENV === 'production') {
      return done(null, false, { message: 'Only QLA email addresses are allowed' });
    }

    // Check if user exists
    let user = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
    
    if (user.rows.length === 0) {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (google_id, email, name, profile_picture, role, grade, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
        [
          profile.id,
          email,
          profile.displayName,
          profile.photos[0]?.value,
          email.includes('teacher') || email.includes('staff') ? 'teacher' : 'student',
          7 // default grade
        ]
      );
      user = result;
    } else {
      // Update user info
      await pool.query(
        'UPDATE users SET name = $1, profile_picture = $2, last_login = NOW() WHERE google_id = $3',
        [profile.displayName, profile.photos[0]?.value, profile.id]
      );
    }

    return done(null, user.rows[0]);
  } catch (error) {
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

// Authentication middleware
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

// Auth Routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Successful authentication
    res.redirect('/dashboard');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Error logging out' });
    }
    res.redirect('/');
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

// User Routes
app.get('/api/users/profile', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*, 
              COUNT(DISTINCT lp.lesson_id) as completed_lessons,
              SUM(lp.time_spent) as total_study_time,
              AVG(a.score) as average_score
       FROM users u
       LEFT JOIN lesson_progress lp ON u.id = lp.user_id AND lp.completed = true
       LEFT JOIN assessments a ON u.id = a.user_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
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
             AVG(lp.progress) as avg_progress
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
    }

    query += ' GROUP BY l.id, u.name ORDER BY l.grade, l.unit, l.lesson_order';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
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
    const progress = await pool.query(
      'SELECT * FROM lesson_progress WHERE lesson_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    res.json({
      ...lesson.rows[0],
      user_progress: progress.rows[0] || null
    });
  } catch (error) {
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
        title, grade, unit, lesson_order, content,
        JSON.parse(practice_problems || '[]'),
        JSON.parse(assessment_questions || '[]'),
        JSON.parse(interactive_elements || '[]'),
        videoPath, req.user.id, 'draft'
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
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
        title, grade, unit, lesson_order, content,
        JSON.parse(practice_problems || '[]'),
        JSON.parse(assessment_questions || '[]'),
        JSON.parse(interactive_elements || '[]'),
        videoPath, status, req.params.id, req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found or unauthorized' });
    }

    res.json(result.rows[0]);
  } catch (error) {
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
        progress = $3, time_spent = lesson_progress.time_spent + $4,
        video_progress = $5, completed = $6, last_accessed = NOW()
      RETURNING *`,
      [req.user.id, lesson_id, progress, time_spent, video_progress, completed]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/progress/overview', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' ? req.query.student_id : req.user.id;
    
    const progress = await pool.query(
      `SELECT 
        COUNT(DISTINCT lp.lesson_id) as completed_lessons,
        COUNT(DISTINCT l.id) as total_lessons,
        SUM(lp.time_spent) as total_study_time,
        AVG(a.score) as average_score,
        COUNT(DISTINCT DATE(lp.last_accessed)) as study_days
      FROM lessons l
      LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $1
      LEFT JOIN assessments a ON a.user_id = $1
      WHERE l.status = 'published'`,
      [userId]
    );

    res.json(progress.rows[0]);
  } catch (error) {
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

    const questions = lesson.rows[0].assessment_questions;
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

    const percentage = Math.round((score / totalPoints) * 100);
    const passed = percentage >= 70;

    // Save assessment result
    const result = await pool.query(
      `INSERT INTO assessments (
        user_id, lesson_id, score, total_points,
        percentage, passed, time_taken, answers, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *`,
      [req.user.id, lesson_id, score, totalPoints, percentage, passed, time_taken, JSON.stringify(results)]
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assessments/history', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' ? req.query.student_id : req.user.id;
    
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
    res.status(500).json({ error: error.message });
  }
});

// Skills Routes
app.get('/api/skills', isAuthenticated, async (req, res) => {
  try {
    let query = `
      SELECT s.*, u.name as teacher_name,
             COUNT(DISTINCT sa.user_id) as assigned_count
      FROM skills s
      LEFT JOIN users u ON s.teacher_id = u.id
      LEFT JOIN skill_assignments sa ON s.id = sa.skill_id
    `;

    if (req.user.role === 'student') {
      query += ` JOIN skill_assignments sa2 ON s.id = sa2.skill_id
                 WHERE sa2.user_id = ${req.user.id}`;
    }

    query += ' GROUP BY s.id, u.name ORDER BY s.created_at DESC';

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
});

// Analytics Routes
app.get('/api/analytics/class', isTeacher, async (req, res) => {
  try {
    const { grade, date_from, date_to } = req.query;

    const analytics = await pool.query(
      `SELECT 
        COUNT(DISTINCT u.id) as total_students,
        AVG(lp.progress) as avg_progress,
        SUM(lp.time_spent) as total_study_time,
        COUNT(DISTINCT lp.lesson_id) as lessons_accessed,
        AVG(a.score) as avg_assessment_score
      FROM users u
      LEFT JOIN lesson_progress lp ON u.id = lp.user_id
      LEFT JOIN assessments a ON u.id = a.user_id
      WHERE u.role = 'student'
      ${grade ? 'AND u.grade = $1' : ''}
      ${date_from ? 'AND lp.last_accessed >= $2' : ''}
      ${date_to ? 'AND lp.last_accessed <= $3' : ''}`,
      [grade, date_from, date_to].filter(Boolean)
    );

    res.json(analytics.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/students', isTeacher, async (req, res) => {
  try {
    const students = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.grade,
        COUNT(DISTINCT lp.lesson_id) as completed_lessons,
        AVG(lp.progress) as avg_progress,
        SUM(lp.time_spent) as total_study_time,
        AVG(a.score) as avg_score,
        MAX(lp.last_accessed) as last_active
      FROM users u
      LEFT JOIN lesson_progress lp ON u.id = lp.user_id
      LEFT JOIN assessments a ON u.id = a.user_id
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY avg_progress DESC`
    );

    res.json(students.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket for real-time features
io.on('connection', (socket) => {
  console.log('New WebSocket connection');

  socket.on('join-lesson', (lessonId) => {
    socket.join(`lesson-${lessonId}`);
  });

  socket.on('lesson-progress', (data) => {
    socket.to(`lesson-${data.lessonId}`).emit('student-progress', data);
  });

  socket.on('question-asked', (data) => {
    io.to(`lesson-${data.lessonId}`).emit('new-question', data);
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
  });
});

// Serve static files for production
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong!' 
      : err.message 
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
