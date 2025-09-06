// scripts/seed-data.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function seedData() {
  console.log('🌱 Seeding database with sample data...\n');
  
  try {
    // Create demo users
    console.log('👥 Creating demo users...');
    
    const users = [
      { email: 'teacher@qla.qfschools.qa', name: 'Mohammad Abu-Ghuwaleh', role: 'teacher' },
      { email: 'student1@qla.qfschools.qa', name: 'Ahmed Ali', role: 'student', grade: 7 },
      { email: 'student2@qla.qfschools.qa', name: 'Fatima Hassan', role: 'student', grade: 7 },
      { email: 'student3@qla.qfschools.qa', name: 'Omar Khan', role: 'student', grade: 8 }
    ];
    
    for (const user of users) {
      await pool.query(
        `INSERT INTO users (email, name, role, grade, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
        [user.email, user.name, user.role, user.grade || null]
      );
      console.log(`  ✅ ${user.name} (${user.role})`);
    }
    
    // Create sample skills
    console.log('\n⭐ Creating sample skills...');
    
    const skills = [
      { name: 'Fraction Operations', description: 'Add, subtract, multiply, and divide fractions', grade: 7, difficulty: 'intermediate' },
      { name: 'Order of Operations', description: 'Apply BEDMAS/PEMDAS correctly', grade: 8, difficulty: 'beginner' },
      { name: 'Prime Factorization', description: 'Find prime factors and calculate HCF/LCM', grade: 7, difficulty: 'intermediate' }
    ];
    
    const teacherResult = await pool.query("SELECT id FROM users WHERE role = 'teacher' LIMIT 1");
    const teacherId = teacherResult.rows[0]?.id;
    
    if (teacherId) {
      for (const skill of skills) {
        await pool.query(
          `INSERT INTO skills (name, description, grade, difficulty, teacher_id, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT DO NOTHING`,
          [skill.name, skill.description, skill.grade, skill.difficulty, teacherId]
        );
        console.log(`  ✅ ${skill.name}`);
      }
    }
    
    console.log('\n✅ Database seeding complete!');
    
  } catch (error) {
    console.error('❌ Seeding error:', error);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seedData();
}

module.exports = seedData;
