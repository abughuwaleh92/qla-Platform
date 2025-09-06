// scripts/setup-directories.js
const fs = require('fs').promises;
const path = require('path');

async function setupDirectories() {
  console.log('📁 Setting up directory structure...');
  
  const directories = [
    'public',
    'public/lessons',
    'public/lessons/grade7',
    'public/lessons/grade8',
    'public/assets',
    'uploads',
    'uploads/videos',
    'uploads/images',
    'uploads/documents',
    'logs',
    'backups',
    'temp'
  ];
  
  for (const dir of directories) {
    const fullPath = path.join(__dirname, '..', dir);
    try {
      await fs.mkdir(fullPath, { recursive: true });
      console.log(`  ✅ ${dir}`);
    } catch (error) {
      console.error(`  ❌ Error creating ${dir}:`, error.message);
    }
  }
  
  console.log('✅ Directory structure ready\n');
}

if (require.main === module) {
  setupDirectories();
}

module.exports = setupDirectories;
