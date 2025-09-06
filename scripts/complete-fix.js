// scripts/complete-fix.js
// Run this script to fix all deployment issues
// Usage: node scripts/complete-fix.js

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixEverything() {
  console.log('🔧 Running Complete QLA LMS Fix...\n');
  
  try {
    // Step 1: Create all required directories
    console.log('📁 Step 1: Creating directory structure...');
    const dirs = [
      'public',
      'public/lessons',
      'public/lessons/grade7', 
      'public/lessons/grade8',
      'public/assets',
      'uploads',
      'uploads/videos',
      'uploads/images'
    ];
    
    for (const dir of dirs) {
      const fullPath = path.join(__dirname, '..', dir);
      await fs.mkdir(fullPath, { recursive: true });
      console.log(`  ✅ ${dir}`);
    }

    // Step 2: Create all database tables
    console.log('\n📊 Step 2: Creating database tables...');
    
    // Drop and recreate tables to ensure clean state
    await pool.query(`
      -- Drop existing tables if they exist
      DROP TABLE IF EXISTS lesson_interactions CASCADE;
      DROP TABLE IF EXISTS interactive_elements CASCADE;
      DROP TABLE IF EXISTS practice_sessions CASCADE;
      DROP TABLE IF EXISTS achievements CASCADE;
      DROP TABLE IF EXISTS messages CASCADE;
      DROP TABLE IF EXISTS announcements CASCADE;
      DROP TABLE IF EXISTS skill_assignments CASCADE;
      DROP TABLE IF EXISTS skills CASCADE;
      DROP TABLE IF EXISTS assessments CASCADE;
      DROP TABLE IF EXISTS lesson_progress CASCADE;
      DROP TABLE IF EXISTS lessons CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS session CASCADE;
    `);
    console.log('  ✅ Old tables dropped');

    // Create fresh tables
    await pool.query(`
      -- Session table
      CREATE TABLE "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
      CREATE INDEX "IDX_session_expire" ON "session" ("expire");

      -- Users table
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        profile_picture TEXT,
        role VARCHAR(50) DEFAULT 'student',
        grade INTEGER,
        bio TEXT,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Lessons table with all fields
      CREATE TABLE lessons (
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
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(grade, unit, lesson_order)
      );

      -- Lesson progress table
      CREATE TABLE lesson_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        progress INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        video_progress INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        last_accessed TIMESTAMP DEFAULT NOW(),
        notes TEXT,
        UNIQUE(user_id, lesson_id)
      );

      -- Assessments table
      CREATE TABLE assessments (
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

      -- Skills table
      CREATE TABLE skills (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        grade INTEGER,
        difficulty VARCHAR(50),
        due_date DATE,
        teacher_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Skill assignments table
      CREATE TABLE skill_assignments (
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

      -- Announcements table
      CREATE TABLE announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        teacher_id INTEGER REFERENCES users(id),
        grade INTEGER,
        priority VARCHAR(50) DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Messages table
      CREATE TABLE messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
        subject VARCHAR(255),
        content TEXT NOT NULL,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Achievements table
      CREATE TABLE achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        earned_at TIMESTAMP DEFAULT NOW()
      );

      -- Practice sessions table
      CREATE TABLE practice_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        problem_type VARCHAR(100),
        problems_attempted INTEGER DEFAULT 0,
        problems_correct INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Interactive elements table
      CREATE TABLE interactive_elements (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        element_type VARCHAR(100),
        element_data JSONB,
        position INTEGER DEFAULT 0,
        required BOOLEAN DEFAULT FALSE,
        points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Lesson interactions table
      CREATE TABLE lesson_interactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        interaction_type VARCHAR(100),
        interaction_data JSONB,
        correct BOOLEAN,
        points_earned INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Create indexes
      CREATE INDEX idx_lesson_progress_user ON lesson_progress(user_id);
      CREATE INDEX idx_lesson_progress_lesson ON lesson_progress(lesson_id);
      CREATE INDEX idx_assessments_user ON assessments(user_id);
      CREATE INDEX idx_messages_receiver ON messages(receiver_id);
      CREATE INDEX idx_skill_assignments_user ON skill_assignments(user_id);
    `);
    console.log('  ✅ All tables created');

    // Step 3: Insert sample data
    console.log('\n👥 Step 3: Creating users and sample data...');
    
    // Create teacher account
    const teacherResult = await pool.query(
      `INSERT INTO users (email, name, role, grade) 
       VALUES ($1, $2, $3, NULL) 
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ['mohammad.abughuwaleh@qla.qfschools.qa', 'Mohammad Abughuwaleh', 'teacher']
    );
    const teacherId = teacherResult.rows[0].id;
    console.log(`  ✅ Teacher account created (ID: ${teacherId})`);

    // Create demo students
    const students = [
      { email: 'ahmed.ali@qla.qfschools.qa', name: 'Ahmed Ali', grade: 7 },
      { email: 'fatima.hassan@qla.qfschools.qa', name: 'Fatima Hassan', grade: 7 },
      { email: 'omar.khan@qla.qfschools.qa', name: 'Omar Khan', grade: 8 },
      { email: 'sara.ahmed@qla.qfschools.qa', name: 'Sara Ahmed', grade: 8 },
      { email: 'khalid.mohamed@qla.qfschools.qa', name: 'Khalid Mohamed', grade: 7 }
    ];

    for (const student of students) {
      await pool.query(
        `INSERT INTO users (email, name, role, grade)
         VALUES ($1, $2, 'student', $3)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, grade = EXCLUDED.grade`,
        [student.email, student.name, student.grade]
      );
      console.log(`  ✅ Student: ${student.name} (Grade ${student.grade})`);
    }

    // Step 4: Create comprehensive lesson data
    console.log('\n📚 Step 4: Creating lessons...');
    
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
        title: 'Fractions and Operations',
        grade: 7,
        unit: 2,
        lesson_order: 0,
        content: 'Learn to add, subtract, multiply, and divide fractions. Master mixed numbers and improper fractions.',
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
        title: 'Linear Equations',
        grade: 8,
        unit: 2,
        lesson_order: 0,
        content: 'Solve single-variable linear equations and understand the concept of equality.',
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
        RETURNING id`,
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
      console.log(`  ✅ ${lesson.title} (ID: ${result.rows[0].id})`);
    }

    // Step 5: Create sample skills
    console.log('\n⭐ Step 5: Creating skills...');
    
    const skills = [
      { name: 'Fraction Operations', description: 'Add, subtract, multiply, and divide fractions', grade: 7, difficulty: 'intermediate' },
      { name: 'Order of Operations', description: 'Apply BEDMAS/PEMDAS correctly', grade: 8, difficulty: 'beginner' },
      { name: 'Prime Factorization', description: 'Find prime factors and calculate HCF/LCM', grade: 7, difficulty: 'intermediate' },
      { name: 'Linear Equations', description: 'Solve single-variable equations', grade: 8, difficulty: 'intermediate' },
      { name: 'Number Classification', description: 'Identify rational and irrational numbers', grade: 7, difficulty: 'beginner' }
    ];

    for (const skill of skills) {
      const skillResult = await pool.query(
        `INSERT INTO skills (name, description, grade, difficulty, teacher_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [skill.name, skill.description, skill.grade, skill.difficulty, teacherId]
      );
      console.log(`  ✅ ${skill.name} (Grade ${skill.grade})`);

      // Assign to students in that grade
      await pool.query(
        `INSERT INTO skill_assignments (skill_id, user_id, assigned_at, status, progress)
         SELECT $1, id, NOW(), 'assigned', 0
         FROM users 
         WHERE role = 'student' AND grade = $2
         ON CONFLICT (skill_id, user_id) DO NOTHING`,
        [skillResult.rows[0].id, skill.grade]
      );
    }

    // Step 6: Add sample progress for demo
    console.log('\n📈 Step 6: Adding sample progress data...');
    
    // Get all students
    const studentsResult = await pool.query(`SELECT id, name FROM users WHERE role = 'student'`);
    const lessonsResult = await pool.query(`SELECT id, title FROM lessons`);
    
    for (const student of studentsResult.rows) {
      // Add progress to some lessons
      for (let i = 0; i < Math.min(3, lessonsResult.rows.length); i++) {
        const lesson = lessonsResult.rows[i];
        const progress = Math.floor(Math.random() * 100);
        const completed = progress === 100;
        
        await pool.query(
          `INSERT INTO lesson_progress (user_id, lesson_id, progress, time_spent, completed, last_accessed)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (user_id, lesson_id) 
           DO UPDATE SET 
             progress = EXCLUDED.progress,
             time_spent = lesson_progress.time_spent + EXCLUDED.time_spent,
             completed = EXCLUDED.completed,
             last_accessed = NOW()`,
          [student.id, lesson.id, progress, Math.floor(Math.random() * 3600), completed]
        );
      }
      
      // Add some assessments
      if (Math.random() > 0.5) {
        const lesson = lessonsResult.rows[0];
        const score = Math.floor(Math.random() * 50) + 50;
        await pool.query(
          `INSERT INTO assessments (user_id, lesson_id, score, total_points, percentage, passed, time_taken, created_at)
           VALUES ($1, $2, $3, 100, $3, $4, $5, NOW())`,
          [student.id, lesson.id, score, score >= 70, Math.floor(Math.random() * 900) + 300]
        );
      }
    }
    console.log('  ✅ Sample progress data added');

    // Step 7: Create lesson HTML files
    console.log('\n📄 Step 7: Creating lesson HTML files...');
    
    const lessonTemplate = (lesson) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${lesson.title} - QLA Mathematics</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
  </style>
</head>
<body class="bg-gray-50">
  <div class="max-w-4xl mx-auto p-8">
    <div class="bg-white rounded-lg shadow-lg p-8">
      <h1 class="text-3xl font-bold text-purple-900 mb-4">${lesson.title}</h1>
      <p class="text-gray-700 mb-6">${lesson.content}</p>
      
      <div class="bg-blue-50 p-6 rounded-lg mb-6">
        <h2 class="text-xl font-semibold mb-3">Learning Objectives</h2>
        <ul class="list-disc list-inside space-y-2 text-gray-700">
          <li>Understand the key concepts</li>
          <li>Apply knowledge to solve problems</li>
          <li>Master the skills through practice</li>
        </ul>
      </div>
      
      <div class="mt-8">
        <button class="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition">
          Start Practice Problems
        </button>
      </div>
    </div>
  </div>
</body>
</html>`;

    for (const lesson of lessons) {
      const filename = `lesson-${lesson.unit}-${lesson.lesson_order}.html`;
      const filepath = path.join(__dirname, '..', 'public', 'lessons', `grade${lesson.grade}`, filename);
      await fs.writeFile(filepath, lessonTemplate(lesson));
      console.log(`  ✅ Created: grade${lesson.grade}/${filename}`);
    }

    // Step 8: Create lesson bridge file
    console.log('\n🌉 Step 8: Creating lesson bridge...');
    
    const bridgeContent = `// QLA Lesson Bridge - Handles communication between lessons and main app
window.QLA_BRIDGE = {
  initialized: true,
  lessonId: null,
  
  init: function() {
    console.log('QLA Lesson Bridge initialized');
    this.lessonId = document.querySelector('[data-lesson-id]')?.dataset.lessonId;
  },
  
  sendProgress: function(data) {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'lesson-progress',
        ...data
      }, '*');
    }
  },
  
  sendInteraction: function(interaction) {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'lesson-interaction',
        interaction: interaction
      }, '*');
    }
  }
};

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.QLA_BRIDGE.init());
} else {
  window.QLA_BRIDGE.init();
}`;

    await fs.writeFile(path.join(__dirname, '..', 'public', 'lesson-bridge.js'), bridgeContent);
    console.log('  ✅ Lesson bridge created');

    // Final verification
    console.log('\n✅ COMPLETE FIX APPLIED SUCCESSFULLY!\n');
    
    // Show summary
    const summary = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'student') as students,
        (SELECT COUNT(*) FROM users WHERE role = 'teacher') as teachers,
        (SELECT COUNT(*) FROM lessons) as lessons,
        (SELECT COUNT(*) FROM skills) as skills
    `);
    
    const stats = summary.rows[0];
    console.log('📊 Database Summary:');
    console.log(`   • Teachers: ${stats.teachers}`);
    console.log(`   • Students: ${stats.students}`);
    console.log(`   • Lessons: ${stats.lessons}`);
    console.log(`   • Skills: ${stats.skills}`);
    
    console.log('\n🎉 Your QLA LMS should now be fully functional!');
    console.log('   1. Restart your server: npm start');
    console.log('   2. Login with: mohammad.abughuwaleh@qla.qfschools.qa');
    console.log('   3. You should now see all lessons and students\n');

  } catch (error) {
    console.error('\n❌ Error during fix:', error);
    console.error('Details:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the fix
if (require.main === module) {
  fixEverything();
}

module.exports = fixEverything;
