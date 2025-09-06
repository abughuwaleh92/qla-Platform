// verify-lessons.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function verifyLessons() {
  console.log('🔍 QLA LMS Lesson Verification\n');
  console.log('=' .repeat(50));
  
  let hasIssues = false;
  
  try {
    // Check database connection
    console.log('\n📊 Database Status:');
    try {
      await pool.query('SELECT 1');
      console.log('✅ Database connected');
    } catch (dbErr) {
      console.log('❌ Database connection failed:', dbErr.message);
      hasIssues = true;
    }
    
    // Check database lessons
    const dbLessons = await pool.query(
      'SELECT * FROM lessons ORDER BY grade, unit, lesson_order'
    );
    
    console.log(`\n📚 Database Lessons (${dbLessons.rows.length} total):`);
    console.log('-'.repeat(50));
    
    const fileStatus = [];
    
    for (const lesson of dbLessons.rows) {
      const expectedFile = `lesson-${lesson.unit}-${lesson.lesson_order}.html`;
      const expectedPath = path.join(
        __dirname, 
        'public', 
        'lessons', 
        `grade${lesson.grade}`,
        expectedFile
      );
      
      const fileExists = fs.existsSync(expectedPath);
      
      console.log(`\nGrade ${lesson.grade} | Unit ${lesson.unit} | Order ${lesson.lesson_order}`);
      console.log(`  Title: ${lesson.title}`);
      console.log(`  Status: ${lesson.status}`);
      console.log(`  File: ${expectedFile} ${fileExists ? '✅' : '❌ MISSING'}`);
      
      if (!fileExists) {
        console.log(`  Expected at: ${expectedPath}`);
        hasIssues = true;
      }
      
      // Check content
      if (lesson.assessment_questions) {
        const questions = lesson.assessment_questions;
        console.log(`  Assessment: ${questions.length} questions`);
      }
      
      if (lesson.practice_problems) {
        const problems = lesson.practice_problems;
        console.log(`  Practice: ${problems.length} problems`);
      }
      
      fileStatus.push({
        lesson,
        file: expectedFile,
        exists: fileExists,
        path: expectedPath
      });
    }
    
    // Check file system
    console.log('\n📁 File System Check:');
    console.log('-'.repeat(50));
    
    const lessonsDir = path.join(__dirname, 'public', 'lessons');
    
    if (!fs.existsSync(lessonsDir)) {
      console.log('❌ Lessons directory not found at:', lessonsDir);
      console.log('   Run: mkdir -p public/lessons');
      hasIssues = true;
    } else {
      console.log('✅ Lessons directory exists');
      
      // Check each grade directory
      const grades = ['grade7', 'grade8'];
      
      for (const grade of grades) {
        const gradePath = path.join(lessonsDir, grade);
        console.log(`\n  ${grade}:`);
        
        if (!fs.existsSync(gradePath)) {
          console.log(`    ❌ Directory missing`);
          console.log(`       Run: mkdir -p public/lessons/${grade}`);
          hasIssues = true;
        } else {
          const files = fs.readdirSync(gradePath);
          
          if (files.length === 0) {
            console.log('    ⚠️ No files found');
            hasIssues = true;
          } else {
            files.forEach(file => {
              console.log(`    📄 ${file}`);
              
              // Check if file matches expected pattern
              const pattern = /^lesson-(\d+)-(\d+)\.html$/;
              if (!pattern.test(file)) {
                console.log(`       ⚠️ File doesn't match expected pattern (lesson-unit-order.html)`);
                hasIssues = true;
              }
            });
          }
        }
      }
    }
    
    // Check for old directory structure
    console.log('\n🔍 Checking for old directory structure:');
    const oldLessonsDir = path.join(__dirname, 'public', 'Lessons');
    
    if (fs.existsSync(oldLessonsDir)) {
      console.log('⚠️ Found old "Lessons" directory (with capital L)');
      console.log('   Run: mv public/Lessons public/lessons');
      hasIssues = true;
    } else {
      console.log('✅ No old directory structure found');
    }
    
    // Check assets directory
    console.log('\n🖼️ Assets Check:');
    const assetsDir = path.join(__dirname, 'public', 'assets');
    
    if (!fs.existsSync(assetsDir)) {
      console.log('❌ Assets directory missing');
      console.log('   Run: mkdir -p public/assets');
      hasIssues = true;
    } else {
      console.log('✅ Assets directory exists');
      
      const requiredAssets = ['qla_logo.png', 'qla_banner.png'];
      requiredAssets.forEach(asset => {
        const assetPath = path.join(assetsDir, asset);
        const svgPath = path.join(assetsDir, asset.replace('.png', '.svg'));
        
        if (fs.existsSync(assetPath)) {
          console.log(`  ✅ ${asset}`);
        } else if (fs.existsSync(svgPath)) {
          console.log(`  ⚠️ ${asset.replace('.png', '.svg')} (placeholder)`);
        } else {
          console.log(`  ❌ ${asset} missing`);
          hasIssues = true;
        }
      });
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 VERIFICATION SUMMARY:');
    console.log('='.repeat(50));
    
    if (!hasIssues) {
      console.log('✅ All checks passed! Your LMS is ready to use.');
    } else {
      console.log('⚠️ Issues found. Please fix the items marked with ❌ above.');
      console.log('\nQuick fixes:');
      console.log('1. Run: node setup-lessons.js');
      console.log('2. Run: npm run migrate');
      console.log('3. Ensure lesson HTML files are in the correct locations');
    }
    
    // Test user accounts
    console.log('\n👥 Test Accounts:');
    const users = await pool.query('SELECT email, role, grade FROM users ORDER BY role, email');
    
    if (users.rows.length === 0) {
      console.log('❌ No users found. Run migration to create test accounts.');
    } else {
      users.rows.forEach(user => {
        console.log(`  ${user.role === 'teacher' ? '👩‍🏫' : '👨‍🎓'} ${user.email} (${user.role}${user.grade ? `, Grade ${user.grade}` : ''})`);
      });
    }
    
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    hasIssues = true;
  } finally {
    await pool.end();
  }
  
  // Exit with appropriate code
  process.exit(hasIssues ? 1 : 0);
}

// Run verification
verifyLessons();
