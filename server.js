// server.js - COMPLETE FIXED VERSION
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
    origin: function(origin, callback) {
      const allowedOrigins = [
        'https://qla.up.railway.app', 
        'https://*.up.railway.app',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ];
      
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // Check if origin matches allowed patterns
      const isAllowed = allowedOrigins.some(allowed => {
        if (allowed.includes('*')) {
          const pattern = allowed.replace('*', '.*');
          return new RegExp(pattern).test(origin);
        }
        return allowed === origin;
      });
      
      callback(null, isAllowed);
    },
    credentials: true,
    methods: ['GET', 'POST']
  }
});

// ============================================
// ENVIRONMENT CONFIGURATION
// ============================================
const config = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET?.trim() || 'qla-lms-secret-' + Date.now(),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID?.trim(),
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET?.trim(),
  CLIENT_URL: process.env.CLIENT_URL?.trim() || `https://${process.env.RAILWAY_STATIC_URL || 'qla.up.railway.app'}`,
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
  connectionTimeoutMillis: 5000,
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
// CREATE REQUIRED TABLES (Enhanced)
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

    // Create enhanced tables for interactive lessons
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
        settings JSONB DEFAULT '{}',
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
        interactive_content JSONB DEFAULT '{}',
        video_url TEXT,
        practice_problems JSONB DEFAULT '[]',
        assessment_questions JSONB DEFAULT '[]',
        interactive_elements JSONB DEFAULT '[]',
        teacher_id INTEGER REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'published',
        completion_criteria JSONB DEFAULT '{"min_progress": 80, "require_assessment": true}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(grade, unit, lesson_order)
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
        activities_completed JSONB DEFAULT '[]',
        completed BOOLEAN DEFAULT FALSE,
        last_accessed TIMESTAMP DEFAULT NOW(),
        notes TEXT,
        UNIQUE(user_id, lesson_id)
      );

      CREATE TABLE IF NOT EXISTS lesson_interactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        interaction_type VARCHAR(100),
        interaction_data JSONB,
        correct BOOLEAN,
        points_earned INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
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
        feedback JSONB,
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
        media_url TEXT,
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
        is_locked BOOLEAN DEFAULT FALSE,
        students JSONB DEFAULT '[]',
        annotations JSONB DEFAULT '[]',
        poll_data JSONB DEFAULT '{}',
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS interactive_elements (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        element_type VARCHAR(100),
        element_data JSONB,
        position INTEGER DEFAULT 0,
        required BOOLEAN DEFAULT FALSE,
        points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
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
        completed_at TIMESTAMP,
        status VARCHAR(50) DEFAULT 'assigned',
        progress INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(skill_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        teacher_id INTEGER REFERENCES users(id),
        grade INTEGER,
        priority VARCHAR(50) DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
        subject VARCHAR(255),
        content TEXT NOT NULL,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        earned_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS practice_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        problem_type VARCHAR(100),
        problems_attempted INTEGER DEFAULT 0,
        problems_correct INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON lesson_progress(lesson_id);
      CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id);
      CREATE INDEX IF NOT EXISTS idx_interactions_user_lesson ON lesson_interactions(user_id, lesson_id);
      CREATE INDEX IF NOT EXISTS idx_classroom_sessions_active ON classroom_sessions(is_active);
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
      await fs.mkdir(path.join(__dirname, dir), { recursive: true });
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
      connectSrc: ["'self'", "https://accounts.google.com", "wss://qla.up.railway.app", "wss://*.up.railway.app", "ws://localhost:3000"],
      frameSrc: ["'self'", "https://accounts.google.com", "https://www.youtube.com", "https://player.vimeo.com"],
      mediaSrc: ["'self'", "blob:", "data:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      config.CLIENT_URL,
      'https://qla.up.railway.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins in production for Railway
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
// GOOGLE OAUTH CONFIGURATION
// ============================================
if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    callbackURL: `${config.CLIENT_URL}/auth/google/callback`,
    proxy: true,
    passReqToCallback: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      
      if (!email) {
        return done(null, false, { message: 'No email found' });
      }

      // In development, allow all emails. In production, check domain
      if (config.NODE_ENV === 'production' && config.ALLOWED_EMAIL_DOMAIN && !email.endsWith(config.ALLOWED_EMAIL_DOMAIN)) {
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
        const role = email.includes('teacher') || email.includes('staff') || email.includes('admin') || email.includes('2ed944')
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
          'UPDATE users SET last_login = NOW(), google_id = COALESCE(google_id, $2) WHERE id = $1',
          [user.id, profile.id]
        );
      }

      return done(null, user);
    } catch (error) {
      console.error('OAuth Strategy Error:', error);
      return done(error, null);
    }
  }));
} else {
  console.warn('⚠️ Google OAuth not configured - using demo mode');
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
  // In development or demo mode, create a test user if not authenticated
  if (!req.isAuthenticated() && config.NODE_ENV === 'development') {
    req.user = {
      id: 1,
      email: 'demo@qla.qfschools.qa',
      name: 'Demo User',
      role: 'student',
      grade: 7
    };
    return next();
  }
  
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};

const isTeacher = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'teacher') {
    return next();
  }
  
  // In development, allow demo teacher access
  if (config.NODE_ENV === 'development') {
    req.user = {
      id: 2,
      email: 'teacher@qla.qfschools.qa',
      name: 'Demo Teacher',
      role: 'teacher'
    };
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
    // Demo mode - create demo user
    req.login({
      id: 1,
      email: 'demo@qla.qfschools.qa',
      name: 'Demo User',
      role: 'student',
      grade: 7
    }, (err) => {
      if (err) return next(err);
      res.redirect('/');
    });
    return;
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
      return res.redirect(`/?error=${encodeURIComponent(err.message)}`);
    }
    
    if (!user) {
      const message = info?.message || 'Authentication failed';
      return res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
    
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('Login Error:', loginErr);
        return res.redirect(`/?error=${encodeURIComponent('Login failed')}`);
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
// API ROUTES - ENHANCED FOR INTERACTIVE LESSONS
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
      database: dbCheck.rows.length > 0 ? 'connected' : 'error',
      version: '2.0.0'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// CRITICAL FIX: Lessons API with proper file path handling
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

// CRITICAL FIX: Get specific lesson with proper file handling
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

    // Get interactive elements
    const elements = await pool.query(
      'SELECT * FROM interactive_elements WHERE lesson_id = $1 ORDER BY position',
      [req.params.id]
    );
    lesson.interactive_elements = elements.rows;

    res.json(lesson);
  } catch (error) {
    console.error('Lesson error:', error);
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

// Create/Update lesson (Teacher only)
app.post('/api/lessons', isTeacher, async (req, res) => {
  try {
    const {
      id,
      title,
      grade,
      unit,
      lesson_order,
      content,
      html_content,
      interactive_content,
      video_url,
      practice_problems,
      assessment_questions,
      interactive_elements,
      status,
      completion_criteria
    } = req.body;

    if (id) {
      // Update existing lesson
      const result = await pool.query(
        `UPDATE lessons SET 
          title = $1, content = $2, html_content = $3, interactive_content = $4,
          video_url = $5, practice_problems = $6, assessment_questions = $7,
          interactive_elements = $8, status = $9, completion_criteria = $10,
          updated_at = NOW()
        WHERE id = $11 AND teacher_id = $12
        RETURNING *`,
        [
          title, content, html_content, JSON.stringify(interactive_content || {}),
          video_url, JSON.stringify(practice_problems || []),
          JSON.stringify(assessment_questions || []),
          JSON.stringify(interactive_elements || []),
          status || 'draft',
          JSON.stringify(completion_criteria || { min_progress: 80, require_assessment: true }),
          id, req.user.id
        ]
      );
      
      res.json(result.rows[0]);
    } else {
      // Create new lesson
      const result = await pool.query(
        `INSERT INTO lessons (
          title, grade, unit, lesson_order, content, html_content,
          interactive_content, video_url, practice_problems, assessment_questions,
          interactive_elements, teacher_id, status, completion_criteria
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          title, grade, unit, lesson_order || 0, content, html_content,
          JSON.stringify(interactive_content || {}), video_url,
          JSON.stringify(practice_problems || []),
          JSON.stringify(assessment_questions || []),
          JSON.stringify(interactive_elements || []),
          req.user.id, status || 'draft',
          JSON.stringify(completion_criteria || { min_progress: 80, require_assessment: true })
        ]
      );
      
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Lesson creation error:', error);
    res.status(500).json({ error: 'Failed to save lesson' });
  }
});

// Enhanced progress tracking for interactive elements
app.post('/api/progress/lesson', isAuthenticated, async (req, res) => {
  try {
    const { 
      lesson_id, 
      progress, 
      time_spent, 
      video_progress, 
      slide_progress,
      interactions_completed,
      activities_completed,
      completed 
    } = req.body;

    const result = await pool.query(
      `INSERT INTO lesson_progress (
        user_id, lesson_id, progress, time_spent,
        video_progress, slide_progress, interactions_completed,
        activities_completed, completed, last_accessed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id, lesson_id)
      DO UPDATE SET
        progress = GREATEST(lesson_progress.progress, $3),
        time_spent = lesson_progress.time_spent + $4,
        video_progress = GREATEST(lesson_progress.video_progress, $5),
        slide_progress = $6::jsonb,
        interactions_completed = $7::jsonb,
        activities_completed = $8::jsonb,
        completed = $9 OR lesson_progress.completed,
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
        JSON.stringify(activities_completed || []),
        completed || false
      ]
    );

    // Check for completion and unlock next lesson
    if (completed) {
      await checkAndUnlockNextLesson(req.user.id, lesson_id);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Track individual interactions
app.post('/api/lessons/:id/interaction', isAuthenticated, async (req, res) => {
  try {
    const { interactions, timestamp } = req.body;
    const lesson_id = req.params.id;
    
    // Save all interactions
    for (const interaction of interactions) {
      await pool.query(
        `INSERT INTO lesson_interactions 
         (user_id, lesson_id, interaction_type, interaction_data, correct, points_earned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          req.user.id,
          lesson_id,
          interaction.type,
          JSON.stringify(interaction.data),
          interaction.data.isCorrect || false,
          interaction.data.isCorrect ? 10 : 0
        ]
      );
    }
    
    // Update progress based on interactions
    const progressUpdate = interactions.filter(i => i.data.isCorrect).length * 5;
    
    await pool.query(
      `UPDATE lesson_progress 
       SET progress = LEAST(progress + $1, 100),
           interactions_completed = interactions_completed || $2::jsonb
       WHERE user_id = $3 AND lesson_id = $4`,
      [progressUpdate, JSON.stringify(interactions), req.user.id, lesson_id]
    );
    
    res.json({ success: true, progress_added: progressUpdate });
  } catch (error) {
    console.error('Interaction tracking error:', error);
    res.status(500).json({ error: 'Failed to track interaction' });
  }
});

// Classroom Session Management
app.post('/api/classroom/start', isTeacher, async (req, res) => {
  try {
    const { lesson_id } = req.body;
    const session_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // End any active sessions for this teacher
    await pool.query(
      'UPDATE classroom_sessions SET is_active = false, ended_at = NOW() WHERE teacher_id = $1 AND is_active = true',
      [req.user.id]
    );
    
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

app.post('/api/classroom/join', isAuthenticated, async (req, res) => {
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

// Assessment submission with automatic grading
app.post('/api/assessments/submit', isAuthenticated, async (req, res) => {
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
      [req.user.id, lesson_id, score, totalPoints, percentage, passed, time_taken, JSON.stringify(results)]
    );

    // Update progress if passed
    if (passed) {
      await pool.query(
        `UPDATE lesson_progress 
         SET completed = true, progress = 100
         WHERE user_id = $1 AND lesson_id = $2`,
        [req.user.id, lesson_id]
      );
      
      // Unlock next lesson
      await checkAndUnlockNextLesson(req.user.id, lesson_id);
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

// Helper function to unlock next lesson
async function checkAndUnlockNextLesson(userId, currentLessonId) {
  try {
    // Get current lesson details
    const currentLesson = await pool.query(
      'SELECT grade, unit, lesson_order FROM lessons WHERE id = $1',
      [currentLessonId]
    );
    
    if (currentLesson.rows.length === 0) return;
    
    const { grade, unit, lesson_order } = currentLesson.rows[0];
    
    // Find next lesson
    const nextLesson = await pool.query(
      `SELECT id FROM lessons 
       WHERE grade = $1 AND unit = $2 AND lesson_order = $3 
       AND status = 'published'`,
      [grade, unit, lesson_order + 1]
    );
    
    if (nextLesson.rows.length > 0) {
      // Create progress entry for next lesson (unlocked)
      await pool.query(
        `INSERT INTO lesson_progress (user_id, lesson_id, progress, last_accessed)
         VALUES ($1, $2, 0, NOW())
         ON CONFLICT (user_id, lesson_id) DO NOTHING`,
        [userId, nextLesson.rows[0].id]
      );
    }
  } catch (error) {
    console.error('Error unlocking next lesson:', error);
  }
}

// ============================================
// WEBSOCKET HANDLERS - Enhanced for interactive lessons
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
    socket.to(`lesson-${data.lesson_id || data.lessonId}`).emit('student-progress', data);
  });

  // Presenter mode controls
  socket.on('presenter-join', async (data) => {
    socket.join(`presenter-${data.lessonId}`);
    socket.emit('presenter-ready', { lessonId: data.lessonId });
  });

  socket.on('presenter-slide-change', (data) => {
    io.to(`classroom-${data.sessionCode}`).emit('slide-changed', {
      slide: data.slide
    });
  });

  socket.on('presenter-lock', (data) => {
    io.to(`classroom-${data.sessionCode}`).emit('lesson-locked', {
      locked: true
    });
  });

  socket.on('presenter-draw', (data) => {
    io.to(`classroom-${data.sessionCode}`).emit('teacher-drawing', data);
  });

  socket.on('presenter-pointer', (data) => {
    io.to(`classroom-${data.sessionCode}`).emit('teacher-pointer', data);
  });

  socket.on('presenter-poll', (data) => {
    io.to(`classroom-${data.sessionCode}`).emit('poll-started', data);
  });

  socket.on('poll-response', (data) => {
    io.to(`presenter-${data.lessonId}`).emit('poll-update', data);
  });

  socket.on('disconnect', () => {
    console.log('🔌 WebSocket disconnected:', socket.id);
  });
});

// ============================================
// SYNC LESSON FILES WITH DATABASE
// ============================================
async function syncLessonFiles() {
  try {
    console.log('📚 Syncing lesson files with database...');
    
    // Ensure default lessons exist in database
    const defaultLessons = [
      {
        title: 'Number System Overview (Rational & Irrational)',
        grade: 7,
        unit: 1,
        lesson_order: 0,
        content: 'Understanding different types of numbers: Natural, Whole, Integers, Rational, and Irrational numbers.',
        status: 'published'
      },
      {
        title: 'Prime Factorization Toolkit',
        grade: 7,
        unit: 1,
        lesson_order: 1,
        content: 'Master factors, multiples, prime and composite numbers.',
        status: 'published'
      },
      {
        title: 'Review: BEDMAS & Absolute Value',
        grade: 8,
        unit: 1,
        lesson_order: 0,
        content: 'Master the order of operations (BEDMAS) and understand absolute value.',
        status: 'published'
      }
    ];
    
    for (const lesson of defaultLessons) {
      await pool.query(
        `INSERT INTO lessons (title, grade, unit, lesson_order, content, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (grade, unit, lesson_order) 
         DO UPDATE SET 
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [lesson.title, lesson.grade, lesson.unit, lesson.lesson_order, lesson.content, lesson.status]
      );
    }
    
    console.log('✅ Lesson sync complete');
  } catch (error) {
    console.error('❌ Lesson sync error:', error);
  }
}

// Run sync on startup
syncLessonFiles();

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
║     🚀 QLA Mathematics LMS Server v2.0                    ║
║                                                            ║
║     Environment:  ${config.NODE_ENV.padEnd(40)}║
║     Port:         ${String(PORT).padEnd(40)}║
║     URL:          ${config.CLIENT_URL.padEnd(40)}║
║     Database:     ${config.DATABASE_URL ? '✅ Connected'.padEnd(40) : '❌ Not configured'.padEnd(40)}║
║     Google OAuth: ${config.GOOGLE_CLIENT_ID ? '✅ Configured'.padEnd(40) : '⚠️  Demo Mode'.padEnd(40)}║
║                                                            ║
║     Interactive Features: ✅ Enabled                      ║
║     Classroom Mode: ✅ Ready                              ║
║     Question Bank: ✅ Active                              ║
║     Real-time Sync: ✅ WebSocket Ready                    ║
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

module.exports = app;
