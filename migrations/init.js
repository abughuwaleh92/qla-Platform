// migrations/init.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'student',
        grade INTEGER DEFAULT 7,
        profile_picture TEXT,
        bio TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        settings JSONB DEFAULT '{}'::jsonb
      )
    `);

    // Create lessons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        grade INTEGER NOT NULL,
        unit INTEGER NOT NULL,
        lesson_order INTEGER NOT NULL,
        content TEXT,
        html_content TEXT,
        video_url TEXT,
        practice_problems JSONB DEFAULT '[]'::jsonb,
        assessment_questions JSONB DEFAULT '[]'::jsonb,
        interactive_elements JSONB DEFAULT '[]'::jsonb,
        teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(grade, unit, lesson_order)
      )
    `);

    // Create lesson_progress table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        progress INTEGER DEFAULT 0,
        video_progress INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        time_spent INTEGER DEFAULT 0,
        last_accessed TIMESTAMP DEFAULT NOW(),
        notes TEXT,
        UNIQUE(user_id, lesson_id)
      )
    `);

    // Create assessments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assessments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        total_points INTEGER NOT NULL,
        percentage INTEGER NOT NULL,
        passed BOOLEAN DEFAULT FALSE,
        time_taken INTEGER,
        answers JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
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
        teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create skill_assignments table
    await pool.query(`
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
      )
    `);

    // Create announcements table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        grade INTEGER,
        priority VARCHAR(50) DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
        subject VARCHAR(255),
        content TEXT NOT NULL,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create achievements table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        earned_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create practice_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS practice_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        problem_type VARCHAR(100),
        problems_attempted INTEGER DEFAULT 0,
        problems_correct INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create interactive_slides table for storing lesson slides
    await pool.query(`
      CREATE TABLE IF NOT EXISTS interactive_slides (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        slide_order INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        content JSONB NOT NULL,
        interactions JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(lesson_id, slide_order)
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_lessons_grade_unit ON lessons(grade, unit);
      CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id);
      CREATE INDEX IF NOT EXISTS idx_skill_assignments_user ON skill_assignments(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
    `);

    // Insert sample lesson data (Grade 7 and Grade 8 lessons)
    await pool.query(`
      INSERT INTO lessons (title, grade, unit, lesson_order, content, html_content, status, practice_problems, assessment_questions)
      VALUES 
      ('Number System Overview (Rational & Irrational)', 7, 1, 0, 
       'Understanding different types of numbers: Natural, Whole, Integers, Rational, and Irrational numbers.', 
       '', 'published',
       '[{"question": "Which of the following is an irrational number?", "options": ["1/3", "0.25", "√2", "2/5"], "correct": 2, "explanation": "√2 cannot be expressed as a fraction, making it irrational."}]'::jsonb,
       '[{"question": "Classify the number 3.14159...", "options": ["Rational", "Irrational", "Integer", "Whole"], "correct": 1, "points": 10}]'::jsonb
      ),
      ('Prime Factorization Toolkit', 7, 1, 1,
       'Learning about factors, multiples, prime and composite numbers, factor trees, HCF and LCM.',
       '', 'published',
       '[{"question": "What is the prime factorization of 24?", "options": ["2³ × 3", "2² × 6", "4 × 6", "8 × 3"], "correct": 0}]'::jsonb,
       '[{"question": "Find the HCF of 18 and 24", "options": ["2", "3", "6", "12"], "correct": 2, "points": 10}]'::jsonb
      ),
      ('Review: BEDMAS & Absolute Value', 8, 1, 0,
       'Reviewing order of operations (BEDMAS) and understanding absolute value as distance from zero.',
       '', 'published',
       '[{"question": "Evaluate: 8 - 3 × 2 + 4", "options": ["14", "6", "10", "18"], "correct": 1}]'::jsonb,
       '[{"question": "What is |−7| + 3?", "options": ["4", "10", "-4", "-10"], "correct": 1, "points": 10}]'::jsonb
      )
      ON CONFLICT (grade, unit, lesson_order) DO NOTHING
    `);

    console.log('✅ Database migration completed successfully!');
    
    // Display table creation summary
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n📊 Created tables:');
    tables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
runMigration();
