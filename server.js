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
// ENVIRONMENT VARIABLES (Trimmed)
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
    // Create session table for session storage
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      ) WITH (OIDS=FALSE);
      
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    // Create users table
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
    `);

    // Create lessons table
    await pool.query(`
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
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create lesson_progress table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        progress INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        video_progress INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        last_accessed TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, lesson_id)
      );
    `);

    // Create assessments table
    await pool.query(`
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
    `);

    // Create skills table
    await pool.query(`
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
    `);

    // Create skill_assignments table
    await pool.query(`
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
// CREATE UPLOADS DIRECTORY
// ============================================
async function createUploadsDir() {
  try {
    await fs.mkdir('uploads', { recursive: true });
    console.log('✅ Uploads directory ready');
  } catch (error) {
    console.error('❌ Error creating uploads directory:', error.message);
  }
}
createUploadsDir();

// ============================================
// MIDDLEWARE CONFIGURATION
// ============================================
app.set('trust proxy', 1); // Trust Railway's proxy

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
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
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ============================================
// SESSION CONFIGURATION WITH POSTGRESQL
// ============================================
const sessionStore = new pgSession({
  pool: pool,
  tableName: 'session',
  createTableIfMissing: true,
  pruneSessionInterval: 60 * 15, // Clean expired sessions every 15 minutes
  ttl: 24 * 60 * 60 // 24 hours
});

app.use(session({
  store: sessionStore,
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiry on activity
  cookie: {
    secure: config.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
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
  windowMs: 15 * 60 * 1000, // 15 minutes
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
console.log('🔐 OAuth Configuration Status:', {
  clientId: config.GOOGLE_CLIENT_ID ? '✅ Set' : '❌ Missing',
  clientSecret: config.GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ Missing',
  environment: config.NODE_ENV,
  callbackUrl: config.NODE_ENV === 'production'
    ? 'https://qla.up.railway.app/auth/google/callback'
    : 'http://localhost:3000/auth/google/callback'
});

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
        console.error('❌ No email in Google profile');
        return done(null, false, { message: 'No email found' });
      }

      // Check email domain in production
      if (config.NODE_ENV === 'production' && !email.endsWith(config.ALLOWED_EMAIL_DOMAIN)) {
        console.log(`❌ Rejected: ${email} (not ${config.ALLOWED_EMAIL_DOMAIN})`);
        return done(null, false, { message: `Only ${config.ALLOWED_EMAIL_DOMAIN} emails allowed` });
      }

      console.log(`✅ Processing login for: ${email}`);

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
        console.log(`✅ Created new ${role}: ${email}`);
      } else {
        // Update existing user
        user = result.rows[0];
        
        // Update Google ID if missing (for users created before OAuth)
        if (!user.google_id) {
          await pool.query(
            'UPDATE users SET google_id = $1, last_login = NOW() WHERE id = $2',
            [profile.id, user.id]
          );
        } else {
          await pool.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
          );
        }
        
        console.log(`✅ User logged in: ${email}`);
      }

      return done(null, user);
    } catch (error) {
      console.error('❌ OAuth Strategy Error:', error);
      return done(error, null);
    }
  }));
} else {
  console.error('❌ Google OAuth not configured - missing credentials');
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
      console.error('❌ OAuth Callback Error:', err);
      return res.redirect(`/login-failed?error=${encodeURIComponent(err.message)}`);
    }
    
    if (!user) {
      const message = info?.message || 'Authentication failed';
      console.error('❌ No user:', message);
      return res.redirect(`/login-failed?error=${encodeURIComponent(message)}`);
    }
    
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('❌ Login Error:', loginErr);
        return res.redirect(`/login-failed?error=${encodeURIComponent('Login failed')}`);
      }
      
      console.log(`✅ Successful login: ${user.email}`);
      res.redirect('/');
    });
  })(req, res, next);
});

app.get('/auth/logout', (req, res) => {
  const userEmail = req.user?.email;
  req.logout((err) => {
    if (err) {
      console.error('❌ Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('❌ Session destroy error:', err);
      }
      console.log(`✅ User logged out: ${userEmail}`);
      res.redirect('/');
    });
  });
});

app.get('/login-failed', (req, res) => {
  const error = req.query.error || 'Authentication failed';
  res.status(401).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login Failed - QLA LMS</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          display: flex; 
          justify-content: center; 
          align-items: center; 
          min-height: 100vh; 
          background: linear-gradient(135deg, #6C1D45 0%, #8B2450 100%);
          padding: 20px;
        }
        .container { 
          background: white; 
          padding: 40px; 
          border-radius: 16px; 
          box-shadow: 0 20px 40px rgba(0,0,0,0.15); 
          max-width: 450px;
          width: 100%;
          text-align: center;
        }
        .icon {
          width: 80px;
          height: 80px;
          margin: 0 auto 24px;
          background: #ef4444;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 40px;
        }
        h1 { 
          color: #1f2937; 
          margin-bottom: 16px;
          font-size: 28px;
        }
        .error-message {
          background: #fef2f2;
          color: #991b1b;
          padding: 16px;
          border-radius: 8px;
          margin: 20px 0;
          font-size: 14px;
          word-break: break-word;
        }
        .btn { 
          display: inline-block;
          padding: 12px 24px; 
          background: #6C1D45; 
          color: white; 
          text-decoration: none; 
          border-radius: 8px;
          font-weight: 500;
          margin: 8px;
          transition: background 0.2s;
        }
        .btn:hover {
          background: #8B2450;
        }
        .help {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid #e5e7eb;
          font-size: 14px;
          color: #6b7280;
          text-align: left;
        }
        .help ul {
          margin-top: 12px;
          padding-left: 20px;
        }
        .help li {
          margin: 8px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">⚠️</div>
        <h1>Login Failed</h1>
        <div class="error-message">${error}</div>
        
        <div>
          <a href="/" class="btn">Try Again</a>
          <a href="mailto:support@qla.qfschools.qa" class="btn" style="background:#6b7280">Get Help</a>
        </div>
        
        <div class="help">
          <strong>Common solutions:</strong>
          <ul>
            <li>Use your @qla.qfschools.qa email address</li>
            <li>Clear your browser cookies and cache</li>
            <li>Try using Chrome or Firefox</li>
            <li>Disable browser extensions</li>
            <li>Contact IT support if the problem persists</li>
          </ul>
        </div>
      </div>
    </body>
    </html>
  `);
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
    // Check database connection
    const dbCheck = await pool.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.NODE_ENV,
      database: dbCheck.rows.length > 0 ? 'connected' : 'error',
      version: '1.0.0'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// User Profile
app.get('/api/users/profile', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*,
        COUNT(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed = true) as completed_lessons,
        COALESCE(SUM(lp.time_spent), 0) as total_study_time,
        COALESCE(AVG(a.percentage), 0)::integer as average_score
      FROM users u
      LEFT JOIN lesson_progress lp ON u.id = lp.user_id
      LEFT JOIN assessments a ON u.id = a.user_id
      WHERE u.id = $1
      GROUP BY u.id`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.put('/api/users/profile', isAuthenticated, async (req, res) => {
  try {
    const { name, grade, bio } = req.body;
    const result = await pool.query(
      'UPDATE users SET name = $1, grade = $2, bio = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, grade, bio, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Lessons
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
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *`,
      [
        title,
        parseInt(grade),
        parseInt(unit),
        parseInt(lesson_order) || 0,
        content,
        practice_problems ? JSON.parse(practice_problems) : [],
        assessment_questions ? JSON.parse(assessment_questions) : [],
        interactive_elements ? JSON.parse(interactive_elements) : [],
        videoPath,
        req.user.id,
        'draft'
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Lesson creation error:', error);
    res.status(500).json({ error: 'Failed to create lesson' });
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
        title,
        parseInt(grade),
        parseInt(unit),
        parseInt(lesson_order) || 0,
        content,
        practice_problems ? JSON.parse(practice_problems) : [],
        assessment_questions ? JSON.parse(assessment_questions) : [],
        interactive_elements ? JSON.parse(interactive_elements) : [],
        videoPath,
        status,
        req.params.id,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found or unauthorized' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Lesson update error:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
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
    res.status(500).json({ error: 'Failed to delete lesson' });
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
      [
        req.user.id,
        lesson_id,
        progress || 0,
        time_spent || 0,
        video_progress || 0,
        completed || false
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

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

// Assessments
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

app.get('/api/assessments/history', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' && req.query.student_id
      ? req.query.student_id
      : req.user.id;
    
    const result = await pool.query(
      `SELECT a.*, l.title as lesson_title
       FROM assessments a
       JOIN lessons l ON a.lesson_id = l.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Assessment history error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Skills
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
        GROUP BY s.id, u.name
        ORDER BY s.created_at DESC
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Skills error:', error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

app.post('/api/skills', isTeacher, async (req, res) => {
  try {
    const { name, description, grade, difficulty, due_date } = req.body;

    const result = await pool.query(
      `INSERT INTO skills (name, description, grade, difficulty, due_date, teacher_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [name, description, grade, difficulty, due_date, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Skill creation error:', error);
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

app.post('/api/skills/:id/assign', isTeacher, async (req, res) => {
  try {
    const { student_ids } = req.body;
    const skill_id = req.params.id;

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ error: 'No students selected' });
    }

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

    const assignedCount = assignments.filter(a => a.rows.length > 0).length;

    res.json({
      message: 'Skills assigned successfully',
      assigned_count: assignedCount
    });
  } catch (error) {
    console.error('Skill assignment error:', error);
    res.status(500).json({ error: 'Failed to assign skill' });
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
      [progress || 0, status || 'in_progress', req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill assignment not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Skill progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Analytics (Teacher only)
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
// WEBSOCKET HANDLERS
// ============================================
io.on('connection', (socket) => {
  console.log('🔌 WebSocket connected:', socket.id);

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
    console.log('🔌 WebSocket disconnected:', socket.id);
  });
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
║     Session Store: PostgreSQL                             ║
║                                                            ║
║     Status: ✅ Ready                                      ║
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
