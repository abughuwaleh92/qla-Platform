// railway-fix.js
// Complete fix for QLA LMS Railway deployment
// Usage: node railway-fix.js

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixRailwayDeployment() {
  console.log('🚀 Fixing QLA LMS Railway Deployment...\n');
  
  try {
    // Step 1: Verify database connection
    console.log('📊 Step 1: Checking database connection...');
    try {
      await pool.query('SELECT 1');
      console.log('✅ Database connected');
    } catch (err) {
      console.error('❌ Database connection failed:', err.message);
      console.log('\n⚠️  Make sure DATABASE_URL is set in Railway variables');
      process.exit(1);
    }

    // Step 2: Create all tables if they don't exist
    console.log('\n📊 Step 2: Ensuring all tables exist...');
    await pool.query(`
      -- Create tables if they don't exist
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        profile_picture TEXT,
        role VARCHAR(50) DEFAULT 'student',
        grade INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
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
        practice_problems JSONB DEFAULT '[]'::jsonb,
        assessment_questions JSONB DEFAULT '[]'::jsonb,
        teacher_id INTEGER REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'published',
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

      CREATE TABLE IF NOT EXISTS skills (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        grade INTEGER,
        difficulty VARCHAR(50),
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
        UNIQUE(skill_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        teacher_id INTEGER REFERENCES users(id),
        grade INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
        problems_attempted INTEGER DEFAULT 0,
        problems_correct INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ All tables verified/created');

    // Step 3: Create your teacher account
    console.log('\n👤 Step 3: Creating Mohammad Abughuwaleh teacher account...');
    const teacherResult = await pool.query(
      `INSERT INTO users (email, name, role, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (email) DO UPDATE SET 
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         last_login = NOW()
       RETURNING id, name, email, role`,
      ['mohammad.abughuwaleh@qla.qfschools.qa', 'Mohammad Abughuwaleh', 'teacher']
    );
    const teacherId = teacherResult.rows[0].id;
    console.log(`✅ Teacher account ready: ${teacherResult.rows[0].email} (ID: ${teacherId})`);

    // Step 4: Create demo students
    console.log('\n👥 Step 4: Creating demo students...');
    const students = [
      { email: 'ahmed.ali@qla.qfschools.qa', name: 'Ahmed Ali', grade: 7 },
      { email: 'fatima.hassan@qla.qfschools.qa', name: 'Fatima Hassan', grade: 7 },
      { email: 'omar.khan@qla.qfschools.qa', name: 'Omar Khan', grade: 8 },
      { email: 'sara.ahmed@qla.qfschools.qa', name: 'Sara Ahmed', grade: 8 },
      { email: 'khalid.mohamed@qla.qfschools.qa', name: 'Khalid Mohamed', grade: 7 },
      { email: 'layla.ibrahim@qla.qfschools.qa', name: 'Layla Ibrahim', grade: 8 }
    ];

    const studentIds = [];
    for (const student of students) {
      const result = await pool.query(
        `INSERT INTO users (email, name, role, grade, created_at)
         VALUES ($1, $2, 'student', $3, NOW())
         ON CONFLICT (email) DO UPDATE SET 
           name = EXCLUDED.name,
           grade = EXCLUDED.grade
         RETURNING id`,
        [student.email, student.name, student.grade]
      );
      studentIds.push(result.rows[0].id);
      console.log(`  ✅ ${student.name} (Grade ${student.grade})`);
    }

    // Step 5: Create comprehensive lessons with content
    console.log('\n📚 Step 5: Creating lessons with full content...');
    const lessons = [
      // Grade 7 Lessons
      {
        title: 'Number System Overview (Rational & Irrational)',
        grade: 7,
        unit: 1,
        lesson_order: 0,
        content: 'Understanding different types of numbers: Natural, Whole, Integers, Rational, and Irrational numbers. Learn to classify numbers and convert repeating decimals to fractions.',
        practice_problems: [
          {
            question: "Which of the following is an irrational number?",
            options: ["1/3", "0.25", "√2", "2/5"],
            correct: 2,
            explanation: "√2 cannot be expressed as a fraction, making it irrational."
          },
          {
            question: "Convert 0.333... to a fraction",
            options: ["1/3", "3/10", "1/9", "3/9"],
            correct: 0,
            explanation: "0.333... (repeating) equals 1/3"
          },
          {
            question: "Which set does -5 belong to?",
            options: ["Natural numbers", "Whole numbers", "Integers", "None"],
            correct: 2,
            explanation: "-5 is an integer but not a whole or natural number"
          }
        ],
        assessment_questions: [
          {
            question: "Classify the number 3.14159... (π)",
            options: ["Rational", "Irrational", "Integer", "Whole"],
            correct: 1,
            points: 10
          },
          {
            question: "Which number is NOT rational?",
            options: ["0.5", "√4", "√5", "0.333..."],
            correct: 2,
            points: 10
          },
          {
            question: "Convert 0.666... to a fraction",
            options: ["2/3", "3/5", "6/10", "6/9"],
            correct: 0,
            points: 10
          },
          {
            question: "The smallest set containing -2.5 is:",
            options: ["Natural", "Whole", "Integer", "Rational"],
            correct: 3,
            points: 10
          },
          {
            question: "Which decimal will terminate?",
            options: ["1/3", "1/7", "1/8", "1/9"],
            correct: 2,
            points: 10
          }
        ]
      },
      {
        title: 'Prime Factorization Toolkit',
        grade: 7,
        unit: 1,
        lesson_order: 1,
        content: 'Master factors, multiples, prime and composite numbers. Learn factor trees, and calculate HCF and LCM using prime factorization.',
        practice_problems: [
          {
            question: "What is the prime factorization of 24?",
            options: ["2³ × 3", "2² × 6", "4 × 6", "8 × 3"],
            correct: 0,
            explanation: "24 = 2 × 2 × 2 × 3 = 2³ × 3"
          },
          {
            question: "Find the HCF of 12 and 18",
            options: ["2", "3", "6", "12"],
            correct: 2,
            explanation: "HCF(12,18) = 6"
          }
        ],
        assessment_questions: [
          {
            question: "Find the HCF of 18 and 24",
            options: ["2", "3", "6", "12"],
            correct: 2,
            points: 10
          },
          {
            question: "What is the LCM of 6 and 8?",
            options: ["14", "24", "48", "12"],
            correct: 1,
            points: 10
          },
          {
            question: "Which number is prime?",
            options: ["21", "27", "29", "33"],
            correct: 2,
            points: 10
          },
          {
            question: "Prime factorization of 36 is:",
            options: ["2² × 9", "2² × 3²", "6²", "4 × 9"],
            correct: 1,
            points: 10
          },
          {
            question: "The HCF of 15 and 25 is:",
            options: ["1", "3", "5", "15"],
            correct: 2,
            points: 10
          }
        ]
      },
      {
        title: 'Introduction to Fractions',
        grade: 7,
        unit: 2,
        lesson_order: 0,
        content: 'Understanding fractions as parts of a whole. Learn to add, subtract, multiply, and divide fractions.',
        practice_problems: [],
        assessment_questions: [
          {
            question: "What is 1/2 + 1/3?",
            options: ["2/5", "5/6", "3/5", "1/6"],
            correct: 1,
            points: 10
          }
        ]
      },
      // Grade 8 Lessons
      {
        title: 'Review: BEDMAS & Absolute Value',
        grade: 8,
        unit: 1,
        lesson_order: 0,
        content: 'Master the order of operations (BEDMAS) and understand absolute value as distance from zero.',
        practice_problems: [
          {
            question: "Evaluate: 8 - 3 × 2 + 4",
            options: ["14", "6", "10", "18"],
            correct: 1,
            explanation: "Following BEDMAS: 8 - 6 + 4 = 6"
          },
          {
            question: "What is |−7| + 3?",
            options: ["4", "10", "-4", "-10"],
            correct: 1,
            explanation: "|−7| = 7, so 7 + 3 = 10"
          }
        ],
        assessment_questions: [
          {
            question: "Evaluate: 12 ÷ 4 + 2 × 3",
            options: ["9", "15", "5", "18"],
            correct: 0,
            points: 10
          },
          {
            question: "What is |−5| × |−2|?",
            options: ["10", "-10", "7", "3"],
            correct: 0,
            points: 10
          },
          {
            question: "Evaluate: (8 + 2)² ÷ 5",
            options: ["20", "4", "100", "10"],
            correct: 0,
            points: 10
          },
          {
            question: "What is |3 − 8| + 2?",
            options: ["3", "7", "-3", "13"],
            correct: 1,
            points: 10
          },
          {
            question: "Evaluate: 2³ − 3 × 2",
            options: ["2", "10", "14", "4"],
            correct: 0,
            points: 10
          }
        ]
      },
      {
        title: 'Introduction to Algebra',
        grade: 8,
        unit: 2,
        lesson_order: 0,
        content: 'Learn the basics of algebra, variables, and solving simple equations.',
        practice_problems: [],
        assessment_questions: [
          {
            question: "Solve for x: 2x + 5 = 13",
            options: ["x = 4", "x = 9", "x = 3", "x = 6"],
            correct: 0,
            points: 10
          }
        ]
      }
    ];

    for (const lesson of lessons) {
      const result = await pool.query(
        `INSERT INTO lessons (
          title, grade, unit, lesson_order, content,
          practice_problems, assessment_questions, 
          teacher_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', NOW(), NOW())
        ON CONFLICT (grade, unit, lesson_order) 
        DO UPDATE SET 
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          practice_problems = EXCLUDED.practice_problems,
          assessment_questions = EXCLUDED.assessment_questions,
          teacher_id = EXCLUDED.teacher_id,
          status = 'published',
          updated_at = NOW()
        RETURNING id, title`,
        [
          lesson.title,
          lesson.grade,
          lesson.unit,
          lesson.lesson_order,
          lesson.content,
          JSON.stringify(lesson.practice_problems || []),
          JSON.stringify(lesson.assessment_questions || []),
          teacherId
        ]
      );
      console.log(`  ✅ Created: ${lesson.title} (ID: ${result.rows[0].id})`);
    }

    // Step 6: Create skills and assignments
    console.log('\n⭐ Step 6: Creating skills...');
    const skills = [
      { name: 'Number Classification', description: 'Identify and classify different types of numbers', grade: 7, difficulty: 'beginner' },
      { name: 'Prime Factorization', description: 'Find prime factors and calculate HCF/LCM', grade: 7, difficulty: 'intermediate' },
      { name: 'Fraction Operations', description: 'Add, subtract, multiply, and divide fractions', grade: 7, difficulty: 'intermediate' },
      { name: 'Order of Operations', description: 'Apply BEDMAS/PEMDAS correctly', grade: 8, difficulty: 'beginner' },
      { name: 'Absolute Value', description: 'Understand and calculate absolute values', grade: 8, difficulty: 'beginner' },
      { name: 'Linear Equations', description: 'Solve single-variable equations', grade: 8, difficulty: 'intermediate' }
    ];

    for (const skill of skills) {
      const skillResult = await pool.query(
        `INSERT INTO skills (name, description, grade, difficulty, teacher_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT ON CONSTRAINT skills_name_grade_key
         DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [skill.name, skill.description, skill.grade, skill.difficulty, teacherId]
      ).catch(async (err) => {
        // If unique constraint doesn't exist, just insert
        return await pool.query(
          `INSERT INTO skills (name, description, grade, difficulty, teacher_id, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [skill.name, skill.description, skill.grade, skill.difficulty, teacherId]
        );
      });
      
      if (skillResult.rows.length > 0) {
        console.log(`  ✅ ${skill.name} (Grade ${skill.grade})`);
        
        // Assign to relevant students
        await pool.query(
          `INSERT INTO skill_assignments (skill_id, user_id, assigned_at, status, progress)
           SELECT $1, id, NOW(), 'assigned', 0
           FROM users 
           WHERE role = 'student' AND grade = $2
           ON CONFLICT (skill_id, user_id) DO NOTHING`,
          [skillResult.rows[0].id, skill.grade]
        );
      }
    }

    // Step 7: Add sample progress data
    console.log('\n📈 Step 7: Adding sample progress and activities...');
    
    // Get all lessons
    const lessonsResult = await pool.query('SELECT id, title, grade FROM lessons ORDER BY grade, unit, lesson_order');
    
    // Add progress for each student
    for (const studentId of studentIds) {
      // Get student grade
      const studentData = await pool.query('SELECT grade FROM users WHERE id = $1', [studentId]);
      const studentGrade = studentData.rows[0].grade;
      
      // Add progress to matching grade lessons
      const gradeLessons = lessonsResult.rows.filter(l => l.grade === studentGrade);
      
      for (let i = 0; i < Math.min(3, gradeLessons.length); i++) {
        const lesson = gradeLessons[i];
        const progress = Math.floor(Math.random() * 60) + 40; // 40-100%
        const completed = progress === 100 || Math.random() > 0.5;
        const timeSpent = Math.floor(Math.random() * 3600) + 600; // 10-60 minutes
        
        await pool.query(
          `INSERT INTO lesson_progress (user_id, lesson_id, progress, time_spent, completed, last_accessed)
           VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '${Math.floor(Math.random() * 7)} days')
           ON CONFLICT (user_id, lesson_id) 
           DO UPDATE SET 
             progress = EXCLUDED.progress,
             time_spent = lesson_progress.time_spent + EXCLUDED.time_spent,
             completed = EXCLUDED.completed,
             last_accessed = EXCLUDED.last_accessed`,
          [studentId, lesson.id, progress, timeSpent, completed]
        );
        
        // Add assessment for completed lessons
        if (completed && Math.random() > 0.3) {
          const score = Math.floor(Math.random() * 30) + 70; // 70-100
          await pool.query(
            `INSERT INTO assessments (user_id, lesson_id, score, total_points, percentage, passed, time_taken, created_at)
             VALUES ($1, $2, $3, 100, $3, $4, $5, NOW() - INTERVAL '${Math.floor(Math.random() * 7)} days')`,
            [studentId, lesson.id, score, score >= 70, Math.floor(Math.random() * 900) + 300]
          );
        }
      }
    }
    console.log('  ✅ Sample progress data added for all students');

    // Step 8: Verify file structure
    console.log('\n📁 Step 8: Checking file structure...');
    const dirs = [
      'public',
      'public/lessons',
      'public/lessons/grade7',
      'public/lessons/grade8',
      'public/assets',
      'uploads'
    ];
    
    for (const dir of dirs) {
      const fullPath = path.join(__dirname, dir);
      try {
        await fs.access(fullPath);
        console.log(`  ✅ Directory exists: ${dir}`);
      } catch {
        await fs.mkdir(fullPath, { recursive: true });
        console.log(`  ✅ Created directory: ${dir}`);
      }
    }

    // Step 9: Verify deployment
    console.log('\n🔍 Step 9: Verification...');
    
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'student') as students,
        (SELECT COUNT(*) FROM users WHERE role = 'teacher') as teachers,
        (SELECT COUNT(*) FROM lessons) as lessons,
        (SELECT COUNT(*) FROM lesson_progress) as progress_records,
        (SELECT COUNT(*) FROM assessments) as assessments,
        (SELECT COUNT(*) FROM skills) as skills,
        (SELECT COUNT(*) FROM skill_assignments) as skill_assignments
    `);
    
    const stats = counts.rows[0];
    console.log('\n📊 Final Database Summary:');
    console.log(`  Teachers: ${stats.teachers}`);
    console.log(`  Students: ${stats.students}`);
    console.log(`  Lessons: ${stats.lessons}`);
    console.log(`  Progress Records: ${stats.progress_records}`);
    console.log(`  Assessments: ${stats.assessments}`);
    console.log(`  Skills: ${stats.skills}`);
    console.log(`  Skill Assignments: ${stats.skill_assignments}`);
    
    console.log('\n✅ RAILWAY DEPLOYMENT FIXED SUCCESSFULLY!\n');
    console.log('🎉 Your QLA LMS should now be fully functional with:');
    console.log('   • Your teacher account: mohammad.abughuwaleh@qla.qfschools.qa');
    console.log('   • 6 demo students with progress data');
    console.log('   • 5 complete lessons with assessments');
    console.log('   • 6 skills assigned to students');
    console.log('\n📝 Next steps:');
    console.log('   1. Refresh your Railway app');
    console.log('   2. Login with Google OAuth or use demo mode');
    console.log('   3. You should now see all data in your dashboard!');
    
  } catch (error) {
    console.error('\n❌ Error during fix:', error);
    console.error('Details:', error.message);
    
    if (error.message.includes('connect')) {
      console.log('\n⚠️  Database connection issue. Please check:');
      console.log('   1. DATABASE_URL is set in Railway variables');
      console.log('   2. PostgreSQL add-on is attached to your service');
    }
  } finally {
    await pool.end();
  }
}

// Run the fix
if (require.main === module) {
  fixRailwayDeployment();
}

module.exports = fixRailwayDeployment;
