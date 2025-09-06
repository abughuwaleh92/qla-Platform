
// scripts/sync-lessons-from-files.js
// Usage: node scripts/sync-lessons-from-files.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function ensureLesson(grade, unit, lesson_order, title, filename){
  const existing = await pool.query(
    'SELECT id FROM lessons WHERE grade=$1 AND unit=$2 AND lesson_order=$3',
    [grade, unit, lesson_order]
  );
  if (existing.rows.length){
    console.log(`✓ exists: G${grade} U${unit} L${lesson_order}`);
    return existing.rows[0].id;
  }
  const htmlContent = fs.readFileSync(path.join(__dirname, `../grade${grade}/${filename}`), 'utf8');
  const res = await pool.query(
    `INSERT INTO lessons (title, grade, unit, lesson_order, content, html_content, status)
     VALUES ($1,$2,$3,$4,$5,$6,'published') RETURNING id`,
    [title || filename, grade, unit, lesson_order, `Imported from ${filename}`, htmlContent]
  );
  console.log(`+ inserted: G${grade} U${unit} L${lesson_order} -> id ${res.rows[0].id}`);
  return res.rows[0].id;
}

(async function(){
  try{
    console.log('🔄 Importing lessons from filesystem into DB…');

    // --- Grade 7 mapping (assume Unit 1, orders start at 0) ---
    const g7files = fs.readdirSync(path.join(__dirname,'../grade7'))
      .filter(f=>/^lesson-\d+\.html$/i.test(f)).sort((a,b)=> {
        const na = parseInt(a.match(/\d+/)[0], 10);
        const nb = parseInt(b.match(/\d+/)[0], 10);
        return na-nb;
      });
    // Map lesson-2.html -> order 0, lesson-3.html -> order 1, etc.
    for (let i=0;i<g7files.length;i++){
      const filename = g7files[i];
      const order = i; // 0-based
      await ensureLesson(7, 1, order, `G7 • Unit 1 • Lesson ${order+1}`, filename);
    }

    // --- Grade 8 mapping (assume Unit 1 likewise) ---
    const g8files = fs.readdirSync(path.join(__dirname,'../grade8'))
      .filter(f=>/^lesson-\d+\.html$/i.test(f)).sort((a,b)=>{
        const na = parseInt(a.match(/\d+/)[0], 10);
        const nb = parseInt(b.match(/\d+/)[0], 10);
        return na-nb;
      });
    for (let i=0;i<g8files.length;i++){
      const filename = g8files[i];
      const order = i; // 0-based
      await ensureLesson(8, 1, order, `G8 • Unit 1 • Lesson ${order+1}`, filename);
    }

  }catch(err){
    console.error('❌ Import failed:', err.message);
    process.exit(1);
  }finally{
    await pool.end();
  }
})();
