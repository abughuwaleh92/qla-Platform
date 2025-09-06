// scripts/fix-deployment.js
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixDeployment() {
  console.log('🔧 Fixing QLA LMS Deployment...\n');
  
  try {
    // 1. Create all required directories
    console.log('📁 Creating directory structure...');
    const dirs = [
      'public/lessons/grade7',
      'public/lessons/grade8',
      'public/assets',
      'uploads'
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(path.join(__dirname, '..', dir), { recursive: true });
      console.log(`  ✅ ${dir}`);
    }
    
    // 2. Sync lesson files with database
    console.log('\n📚 Syncing lessons with database...');
    
    const lessons = [
      {
        title: 'Number System Overview (Rational & Irrational)',
        grade: 7,
        unit: 1,
        lesson_order: 0,
        status: 'published'
      },
      {
        title: 'Prime Factorization Toolkit',
        grade: 7,
        unit: 1,
        lesson_order: 1,
        status: 'published'
      },
      {
        title: 'Review: BEDMAS & Absolute Value',
        grade: 8,
        unit: 1,
        lesson_order: 0,
        status: 'published'
      }
    ];
    
    for (const lesson of lessons) {
      await pool.query(
        `INSERT INTO lessons (title, grade, unit, lesson_order, status, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (grade, unit, lesson_order) 
         DO UPDATE SET 
           title = EXCLUDED.title,
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [lesson.title, lesson.grade, lesson.unit, lesson.lesson_order, lesson.status]
      );
      console.log(`  ✅ ${lesson.title}`);
    }
    
    // 3. Create demo users if needed
    console.log('\n👥 Setting up demo users...');
    
    await pool.query(
      `INSERT INTO users (email, name, role, grade)
       VALUES ('teacher@qla.qfschools.qa', 'Demo Teacher', 'teacher', NULL)
       ON CONFLICT (email) DO NOTHING`
    );
    console.log('  ✅ Demo teacher created');
    
    await pool.query(
      `INSERT INTO users (email, name, role, grade)
       VALUES ('student@qla.qfschools.qa', 'Demo Student', 'student', 7)
       ON CONFLICT (email) DO NOTHING`
    );
    console.log('  ✅ Demo student created');
    
    console.log('\n✨ Deployment fixes complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Push to GitHub: git add . && git commit -m "Fix deployment" && git push');
    console.log('2. Railway will auto-deploy');
    console.log('3. Access your app at your Railway URL');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

fixDeployment();
