// scripts/verify-deployment.js
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function verifyDeployment() {
  console.log('🔍 Verifying QLA LMS Deployment...\n');
  let issues = [];
  
  try {
    // Check database connection
    console.log('📊 Checking database...');
    try {
      await pool.query('SELECT 1');
      console.log('  ✅ Database connected');
    } catch (dbErr) {
      console.log('  ❌ Database connection failed');
      issues.push('Database connection failed');
    }
    
    // Check required tables
    const tables = ['users', 'lessons', 'lesson_progress', 'assessments'];
    for (const table of tables) {
      try {
        await pool.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`  ✅ Table '${table}' exists`);
      } catch (err) {
        console.log(`  ❌ Table '${table}' missing`);
        issues.push(`Table '${table}' missing`);
      }
    }
    
    // Check directories
    console.log('\n📁 Checking directories...');
    const dirs = [
      'public/lessons/grade7',
      'public/lessons/grade8',
      'public/assets',
      'uploads'
    ];
    
    for (const dir of dirs) {
      const fullPath = path.join(__dirname, '..', dir);
      try {
        await fs.access(fullPath);
        console.log(`  ✅ ${dir}`);
      } catch (err) {
        console.log(`  ❌ ${dir} missing`);
        issues.push(`Directory '${dir}' missing`);
      }
    }
    
    // Check environment variables
    console.log('\n🔐 Checking environment...');
    const requiredEnvVars = ['DATABASE_URL', 'SESSION_SECRET'];
    const optionalEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    
    for (const envVar of requiredEnvVars) {
      if (process.env[envVar]) {
        console.log(`  ✅ ${envVar} is set`);
      } else {
        console.log(`  ❌ ${envVar} is missing`);
        issues.push(`Environment variable '${envVar}' missing`);
      }
    }
    
    for (const envVar of optionalEnvVars) {
      if (process.env[envVar]) {
        console.log(`  ✅ ${envVar} is set`);
      } else {
        console.log(`  ⚠️  ${envVar} is not set (optional)`);
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    if (issues.length === 0) {
      console.log('✅ All checks passed! Deployment is ready.');
    } else {
      console.log('⚠️ Issues found:');
      issues.forEach(issue => console.log(`  - ${issue}`));
      console.log('\nRun "npm run fix" to attempt automatic fixes.');
    }
    console.log('='.repeat(50) + '\n');
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  } finally {
    await pool.end();
  }
  
  return issues.length === 0;
}

if (require.main === module) {
  verifyDeployment().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = verifyDeployment;
