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
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const dir of directories) {
    const fullPath = path.join(__dirname, '..', dir);
    try {
      await fs.mkdir(fullPath, { recursive: true });
      console.log(`  ✅ ${dir}`);
      successCount++;
    } catch (error) {
      // Check if directory already exists
      try {
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          console.log(`  ✅ ${dir} (already exists)`);
          successCount++;
        } else {
          console.error(`  ❌ ${dir} exists but is not a directory`);
          errorCount++;
        }
      } catch (statError) {
        console.error(`  ❌ Error creating ${dir}: ${error.message}`);
        errorCount++;
      }
    }
  }
  
  console.log(`\n✅ Directory setup complete: ${successCount} successful, ${errorCount} errors\n`);
  
  // Exit with error code if there were errors
  if (errorCount > 0 && process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  setupDirectories().catch(error => {
    console.error('Fatal error during directory setup:', error);
    process.exit(1);
  });
}

module.exports = setupDirectories;
