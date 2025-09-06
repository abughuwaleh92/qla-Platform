// setup-lessons.js
const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up lesson file structure...\n');

// Create directory structure
const dirs = [
  'public',
  'public/lessons',
  'public/lessons/grade7',
  'public/lessons/grade8',
  'public/assets',
  'uploads'
];

dirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  } else {
    console.log(`📁 Directory exists: ${dir}`);
  }
});

// Check for existing lesson files with wrong names
const oldFiles = [
  { 
    old: 'public/Lessons/grade7/lesson-2.html',
    new: 'public/lessons/grade7/lesson-1-0.html'
  },
  { 
    old: 'public/Lessons/grade8/lesson-2.html',
    new: 'public/lessons/grade8/lesson-1-0.html'
  }
];

console.log('\n📚 Checking for lesson files to rename...');

oldFiles.forEach(file => {
  const oldPath = path.join(__dirname, file.old);
  const newPath = path.join(__dirname, file.new);
  
  // Try both uppercase and lowercase Lessons directory
  const alternateOldPath = oldPath.replace('/Lessons/', '/lessons/');
  
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`✅ Renamed: ${file.old} → ${file.new}`);
  } else if (fs.existsSync(alternateOldPath)) {
    fs.renameSync(alternateOldPath, newPath);
    console.log(`✅ Renamed: ${alternateOldPath} → ${file.new}`);
  } else if (fs.existsSync(newPath)) {
    console.log(`✅ File already correct: ${file.new}`);
  } else {
    console.log(`❌ File not found: ${file.old}`);
    console.log(`   Please ensure lesson HTML files are in the correct location`);
  }
});

// Update image paths in lesson files if they exist
console.log('\n🖼️ Updating image paths in lesson files...');

const lessonFiles = [
  'public/lessons/grade7/lesson-1-0.html',
  'public/lessons/grade8/lesson-1-0.html'
];

lessonFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Update image paths
    content = content.replace(/background-image:url\('qla_banner\.png'\)/g, "background-image:url('/assets/qla_banner.png')");
    content = content.replace(/background-image:url\('\.\.\/assets\/qla_banner\.png'\)/g, "background-image:url('/assets/qla_banner.png')");
    content = content.replace(/src="qla_logo\.png"/g, 'src="/assets/qla_logo.png"');
    content = content.replace(/src="\.\.\/assets\/qla_logo\.png"/g, 'src="/assets/qla_logo.png"');
    
    fs.writeFileSync(filePath, content);
    console.log(`✅ Updated image paths in: ${file}`);
  } else {
    console.log(`⚠️ Lesson file not found: ${file}`);
  }
});

// Create placeholder images if they don't exist
console.log('\n🎨 Checking for placeholder images...');

const images = [
  { name: 'qla_logo.png', width: 200, height: 200, color: '#6C1D45' },
  { name: 'qla_banner.png', width: 800, height: 200, color: '#6C1D45' }
];

images.forEach(img => {
  const imgPath = path.join(__dirname, 'public', 'assets', img.name);
  
  if (!fs.existsSync(imgPath)) {
    // Create a simple SVG placeholder
    const svg = `
<svg width="${img.width}" height="${img.height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${img.width}" height="${img.height}" fill="${img.color}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
        fill="white" font-family="Arial" font-size="24" font-weight="bold">
    QLA
  </text>
</svg>`;
    
    // Save as SVG (can be used as placeholder until real images are added)
    const svgPath = imgPath.replace('.png', '.svg');
    fs.writeFileSync(svgPath, svg);
    console.log(`✅ Created placeholder: ${img.name.replace('.png', '.svg')}`);
    console.log(`   Note: Replace with actual ${img.name} file`);
  } else {
    console.log(`✅ Image exists: ${img.name}`);
  }
});

// Create a package.json script entry suggestion
console.log('\n📦 Add these scripts to your package.json:');
console.log(`
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "migrate": "node migrations/init.js",
    "setup": "node setup-lessons.js && npm run migrate",
    "verify": "node verify-lessons.js"
  }
`);

console.log('\n✨ Setup complete! Next steps:');
console.log('1. Run: npm run migrate');
console.log('2. Run: node verify-lessons.js');
console.log('3. Start the server: npm start');
console.log('\nIf on Railway:');
console.log('1. Push changes to GitHub');
console.log('2. Railway will auto-deploy');
console.log('3. Run "npm run migrate" in Railway console');
