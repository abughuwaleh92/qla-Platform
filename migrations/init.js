// migrations/init.js
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  console.log('🚀 Starting database migration...');
  
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
    console.log('✅ Users table created/verified');

    // Create lessons table with proper constraints
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
        status VARCHAR(50) DEFAULT 'published',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(grade, unit, lesson_order)
      )
    `);
    console.log('✅ Lessons table created/verified');

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
    console.log('✅ Lesson progress table created/verified');

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
    console.log('✅ Assessments table created/verified');

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
    console.log('✅ Skills table created/verified');

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
    console.log('✅ Skill assignments table created/verified');

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
    console.log('✅ Announcements table created/verified');

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
    console.log('✅ Messages table created/verified');

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
    console.log('✅ Achievements table created/verified');

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
    console.log('✅ Practice sessions table created/verified');

    // Create interactive_slides table
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
    console.log('✅ Interactive slides table created/verified');

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
    console.log('✅ Indexes created/verified');

    // Insert/Update Grade 7 Lessons
    console.log('📚 Setting up Grade 7 lessons...');
    
    // Grade 7, Unit 1, Lesson 0 - Number System Overview
    await pool.query(`
      INSERT INTO lessons (title, grade, unit, lesson_order, content, status, practice_problems, assessment_questions)
      VALUES (
        'Number System Overview (Rational & Irrational)',
        7,
        1,
        0,
        'Understanding different types of numbers: Natural, Whole, Integers, Rational, and Irrational numbers. Learn to classify numbers into N, W, Z, Q, or Irrational sets. Convert repeating decimals to fractions.',
        'published',
        '[
          {
            "question": "Which of the following is an irrational number?",
            "options": ["1/3", "0.25", "√2", "2/5"],
            "correct": 2,
            "explanation": "√2 cannot be expressed as a fraction, making it irrational."
          },
          {
            "question": "Convert 0.333... to a fraction",
            "options": ["1/3", "3/10", "1/9", "3/9"],
            "correct": 0,
            "explanation": "0.333... (repeating) equals 1/3"
          },
          {
            "question": "Which set does -5 belong to?",
            "options": ["Natural numbers", "Whole numbers", "Integers", "None"],
            "correct": 2,
            "explanation": "-5 is an integer but not a whole or natural number"
          }
        ]'::jsonb,
        '[
          {
            "question": "Classify the number 3.14159... (π)",
            "options": ["Rational", "Irrational", "Integer", "Whole"],
            "correct": 1,
            "points": 10
          },
          {
            "question": "Which number is NOT rational?",
            "options": ["0.5", "√4", "√5", "0.333..."],
            "correct": 2,
            "points": 10
          },
          {
            "question": "Convert 0.666... to a fraction",
            "options": ["2/3", "3/5", "6/10", "6/9"],
            "correct": 0,
            "points": 10
          },
          {
            "question": "The smallest set containing -2.5 is:",
            "options": ["Natural", "Whole", "Integer", "Rational"],
            "correct": 3,
            "points": 10
          },
          {
            "question": "Which decimal will terminate?",
            "options": ["1/3", "1/7", "1/8", "1/9"],
            "correct": 2,
            "points": 10
          }
        ]'::jsonb
      )
      ON CONFLICT (grade, unit, lesson_order) 
      DO UPDATE SET 
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        status = 'published',
        practice_problems = EXCLUDED.practice_problems,
        assessment_questions = EXCLUDED.assessment_questions,
        updated_at = NOW()
    `);

    // Grade 7, Unit 1, Lesson 1 - Prime Factorization
    await pool.query(`
      INSERT INTO lessons (title, grade, unit, lesson_order, content, status, practice_problems, assessment_questions)
      VALUES (
        'Prime Factorization Toolkit',
        7,
        1,
        1,
        'Master factors, multiples, prime and composite numbers. Learn factor trees, and calculate HCF and LCM using prime factorization.',
        'published',
        '[
          {
            "question": "What is the prime factorization of 24?",
            "options": ["2³ × 3", "2² × 6", "4 × 6", "8 × 3"],
            "correct": 0,
            "explanation": "24 = 2 × 2 × 2 × 3 = 2³ × 3"
          },
          {
            "question": "Find the HCF of 12 and 18",
            "options": ["2", "3", "6", "12"],
            "correct": 2,
            "explanation": "HCF(12,18) = 6"
          }
        ]'::jsonb,
        '[
          {
            "question": "Find the HCF of 18 and 24",
            "options": ["2", "3", "6", "12"],
            "correct": 2,
            "points": 10
          },
          {
            "question": "What is the LCM of 6 and 8?",
            "options": ["14", "24", "48", "12"],
            "correct": 1,
            "points": 10
          },
          {
            "question": "Which number is prime?",
            "options": ["21", "27", "29", "33"],
            "correct": 2,
            "points": 10
          },
          {
            "question": "Prime factorization of 36 is:",
            "options": ["2² × 9", "2² × 3²", "6²", "4 × 9"],
            "correct": 1,
            "points": 10
          },
          {
            "question": "The HCF of 15 and 25 is:",
            "options": ["1", "3", "5", "15"],
            "correct": 2,
            "points": 10
          }
        ]'::jsonb
      )
      ON CONFLICT (grade, unit, lesson_order) 
      DO UPDATE SET 
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        status = 'published',
        practice_problems = EXCLUDED.practice_problems,
        assessment_questions = EXCLUDED.assessment_questions,
        updated_at = NOW()
    `);

    // Insert/Update Grade 8 Lessons
    console.log('📚 Setting up Grade 8 lessons...');
    
    // Grade 8, Unit 1, Lesson 0 - BEDMAS Review
    await pool.query(`
      INSERT INTO lessons (title, grade, unit, lesson_order, content, status, practice_problems, assessment_questions)
      VALUES (
        'Review: BEDMAS & Absolute Value',
        8,
        1,
        0,
        'Master the order of operations (BEDMAS) and understand absolute value as distance from zero. Apply these concepts to complex expressions.',
        'published',
        '[
          {
            "question": "Evaluate: 8 - 3 × 2 + 4",
            "options": ["14", "6", "10", "18"],
            "correct": 1,
            "explanation": "Following BEDMAS: 8 - 6 + 4 = 6"
          },
          {
            "question": "What is |−7| + 3?",
            "options": ["4", "10", "-4", "-10"],
            "correct": 1,
            "explanation": "|−7| = 7, so 7 + 3 = 10"
          }
        ]'::jsonb,
        '[
          {
            "question": "Evaluate: 12 ÷ 4 + 2 × 3",
            "options": ["9", "15", "5", "18"],
            "correct": 0,
            "points": 10
          },
          {
            "question": "What is |−5| × |−2|?",
            "options": ["10", "-10", "7", "3"],
            "correct": 0,
            "points": 10
          },
          {
            "question": "Evaluate: (8 + 2)² ÷ 5",
            "options": ["20", "4", "100", "10"],
            "correct": 0,
            "points": 10
          },
          {
            "question": "What is |3 − 8| + 2?",
            "options": ["3", "7", "-3", "13"],
            "correct": 1,
            "points": 10
          },
          {
            "question": "Evaluate: 2³ − 3 × 2",
            "options": ["2", "10", "14", "4"],
            "correct": 0,
            "points": 10
          }
        ]'::jsonb
      )
      ON CONFLICT (grade, unit, lesson_order) 
      DO UPDATE SET 
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        status = 'published',
        practice_problems = EXCLUDED.practice_problems,
        assessment_questions = EXCLUDED.assessment_questions,
        updated_at = NOW()
    `);

    // Create default teacher account for testing
    await pool.query(`
      INSERT INTO users (email, name, role, grade)
      VALUES ('teacher@qla.qfschools.qa', 'Default Teacher', 'teacher', NULL)
      ON CONFLICT (email) DO NOTHING
    `);

    // Create default student account for testing
    await pool.query(`
      INSERT INTO users (email, name, role, grade)
      VALUES ('student@qla.qfschools.qa', 'Test Student', 'student', 7)
      ON CONFLICT (email) DO NOTHING
    `);

    console.log('✅ Sample users created');

    // Display summary
    const lessonCount = await pool.query('SELECT COUNT(*) FROM lessons');
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    
    console.log('\n📊 Migration Summary:');
    console.log(`   - Total lessons: ${lessonCount.rows[0].count}`);
    console.log(`   - Total users: ${userCount.rows[0].count}`);
    console.log('\n✅ Database migration completed successfully!');
    
    // Verify lesson files exist
    console.log('\n📁 Checking lesson files...');
    const lessons = await pool.query('SELECT grade, unit, lesson_order, title FROM lessons ORDER BY grade, unit, lesson_order');
    
    lessons.rows.forEach(lesson => {
      const expectedPath = `public/lessons/grade${lesson.grade}/lesson-${lesson.unit}-${lesson.lesson_order}.html`;
      const exists = fs.existsSync(path.join(__dirname, '..', expectedPath));
      console.log(`   ${exists ? '✅' : '❌'} ${expectedPath} - ${lesson.title}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
runMigration();
