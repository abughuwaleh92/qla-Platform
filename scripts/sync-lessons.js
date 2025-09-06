// scripts/sync-lessons.js
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function syncLessons() {
  console.log('📚 Syncing lessons with database...');
  
  try {
    // Default lessons data
    const lessons = [
      {
        title: 'Number System Overview (Rational & Irrational)',
        grade: 7,
        unit: 1,
        lesson_order: 0,
        content: 'Understanding different types of numbers: Natural, Whole, Integers, Rational, and Irrational numbers.',
        practice_problems: [
          {
            question: "Which of the following is an irrational number?",
            options: ["1/3", "0.25", "√2", "2/5"],
            correct: 2,
            explanation: "√2 cannot be expressed as a fraction, making it irrational."
          }
        ],
        assessment_questions: [
          {
            question: "Classify the number 3.14159... (π)",
            options: ["Rational", "Irrational", "Integer", "Whole"],
            correct: 1,
            points: 10
          }
        ],
        status: 'published'
      },
      {
        title: 'Prime Factorization Toolkit',
        grade: 7,
        unit: 1,
        lesson_order: 1,
        content: 'Master factors, multiples, prime and composite numbers.',
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
          }
        ],
        status: 'published'
      },
      {
        title: 'Review: BEDMAS & Absolute Value',
        grade: 8,
        unit: 1,
        lesson_order: 0,
        content: 'Master the order of operations (BEDMAS) and understand absolute value.',
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
          }
        ],
        status: 'published'
      }
    ];
    
    for (const lesson of lessons) {
      const result = await pool.query(
        `INSERT INTO lessons (
          title, grade, unit, lesson_order, content,
          practice_problems, assessment_questions, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (grade, unit, lesson_order) 
        DO UPDATE SET 
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          practice_problems = EXCLUDED.practice_problems,
          assessment_questions = EXCLUDED.assessment_questions,
          status = EXCLUDED.status,
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
          lesson.status
        ]
      );
      console.log(`  ✅ ${lesson.title} (ID: ${result.rows[0].id})`);
    }
    
    console.log('✅ Lessons synced successfully\n');
  } catch (error) {
    console.error('❌ Error syncing lessons:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  syncLessons();
}

module.exports = syncLessons;
