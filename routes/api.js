const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const emailService = require('../services/emailService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware for checking authentication
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};

const isTeacher = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'teacher') {
    return next();
  }
  res.status(403).json({ error: 'Teacher access required' });
};

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Statistics endpoint
router.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'student') as total_students,
        (SELECT COUNT(*) FROM users WHERE role = 'teacher') as total_teachers,
        (SELECT COUNT(*) FROM lessons WHERE status = 'published') as total_lessons,
        (SELECT COUNT(*) FROM assessments) as total_assessments,
        (SELECT AVG(percentage) FROM assessments) as avg_score
    `);
    
    res.json(stats.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Practice problems routes
router.get('/practice/:lessonId', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT practice_problems FROM lessons WHERE id = $1',
      [req.params.lessonId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    
    res.json(result.rows[0].practice_problems || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/practice/submit', isAuthenticated, async (req, res) => {
  try {
    const { lesson_id, problem_type, problems_attempted, problems_correct, time_spent } = req.body;
    
    const result = await pool.query(
      `INSERT INTO practice_sessions 
       (user_id, lesson_id, problem_type, problems_attempted, problems_correct, time_spent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, lesson_id, problem_type, problems_attempted, problems_correct, time_spent]
    );
    
    // Update user progress
    const accuracy = (problems_correct / problems_attempted) * 100;
    if (accuracy >= 80) {
      await pool.query(
        `UPDATE lesson_progress 
         SET progress = GREATEST(progress, progress + 10)
         WHERE user_id = $1 AND lesson_id = $2`,
        [req.user.id, lesson_id]
      );
    }
    
    res.json({
      ...result.rows[0],
      accuracy: accuracy.toFixed(1)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Interactive slides routes
router.get('/slides/:lessonId', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM interactive_slides 
       WHERE lesson_id = $1 
       ORDER BY slide_order`,
      [req.params.lessonId]
    );
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/slides', isTeacher, async (req, res) => {
  try {
    const { lesson_id, slides } = req.body;
    
    // Delete existing slides
    await pool.query('DELETE FROM interactive_slides WHERE lesson_id = $1', [lesson_id]);
    
    // Insert new slides
    const insertPromises = slides.map((slide, index) => 
      pool.query(
        `INSERT INTO interactive_slides 
         (lesson_id, slide_order, type, title, content, interactions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lesson_id, index, slide.type, slide.title, slide.content, slide.interactions || []]
      )
    );
    
    await Promise.all(insertPromises);
    
    res.json({ message: 'Slides saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Achievements routes
router.get('/achievements', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' && req.query.student_id 
      ? req.query.student_id 
      : req.user.id;
    
    const achievements = await pool.query(
      'SELECT * FROM achievements WHERE user_id = $1 ORDER BY earned_at DESC',
      [userId]
    );
    
    res.json(achievements.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/achievements/check', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    const newAchievements = [];
    
    // Check various achievement conditions
    const stats = await pool.query(
      `SELECT 
        COUNT(DISTINCT lp.lesson_id) as completed_lessons,
        SUM(lp.time_spent) as total_time,
        COUNT(DISTINCT DATE(lp.last_accessed)) as study_days,
        AVG(a.percentage) as avg_score
       FROM lesson_progress lp
       LEFT JOIN assessments a ON a.user_id = lp.user_id
       WHERE lp.user_id = $1 AND lp.completed = true`,
      [userId]
    );
    
    const userStats = stats.rows[0];
    
    // First Lesson Achievement
    if (userStats.completed_lessons >= 1) {
      await checkAndAwardAchievement(userId, 'first_lesson', 'First Steps', 'Completed your first lesson');
    }
    
    // 5 Lessons Achievement
    if (userStats.completed_lessons >= 5) {
      await checkAndAwardAchievement(userId, 'five_lessons', 'Getting Started', 'Completed 5 lessons');
    }
    
    // 10 Lessons Achievement
    if (userStats.completed_lessons >= 10) {
      await checkAndAwardAchievement(userId, 'ten_lessons', 'Dedicated Learner', 'Completed 10 lessons');
    }
    
    // Perfect Score Achievement
    if (userStats.avg_score >= 100) {
      await checkAndAwardAchievement(userId, 'perfect_score', 'Perfectionist', 'Achieved a perfect score on an assessment');
    }
    
    // Study Streak Achievement
    if (userStats.study_days >= 7) {
      await checkAndAwardAchievement(userId, 'week_streak', 'Consistent Learner', 'Studied for 7 consecutive days');
    }
    
    // Time-based Achievement
    const hours = Math.floor(userStats.total_time / 3600);
    if (hours >= 10) {
      await checkAndAwardAchievement(userId, 'ten_hours', 'Time Investor', 'Studied for 10+ hours');
    }
    
    res.json({ achievements_checked: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function checkAndAwardAchievement(userId, type, title, description) {
  // Check if achievement already exists
  const existing = await pool.query(
    'SELECT id FROM achievements WHERE user_id = $1 AND type = $2',
    [userId, type]
  );
  
  if (existing.rows.length === 0) {
    // Award new achievement
    await pool.query(
      'INSERT INTO achievements (user_id, type, title, description) VALUES ($1, $2, $3, $4)',
      [userId, type, title, description]
    );
    
    return true;
  }
  
  return false;
}

// Messages/Communication routes
router.get('/messages', isAuthenticated, async (req, res) => {
  try {
    const messages = await pool.query(
      `SELECT m.*, 
              s.name as sender_name, 
              r.name as receiver_name,
              l.title as lesson_title
       FROM messages m
       LEFT JOIN users s ON m.sender_id = s.id
       LEFT JOIN users r ON m.receiver_id = r.id
       LEFT JOIN lessons l ON m.lesson_id = l.id
       WHERE m.sender_id = $1 OR m.receiver_id = $1
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );
    
    res.json(messages.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/messages', isAuthenticated, async (req, res) => {
  try {
    const { receiver_id, subject, content, lesson_id } = req.body;
    
    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, content, lesson_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, receiver_id, subject, content, lesson_id]
    );
    
    // Send email notification
    const receiver = await pool.query('SELECT * FROM users WHERE id = $1', [receiver_id]);
    if (receiver.rows.length > 0) {
      await emailService.sendEmail(
        receiver.rows[0].email,
        `New message: ${subject}`,
        `<p>You have a new message from ${req.user.name}:</p><p>${content}</p>`
      );
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/messages/:id/read', isAuthenticated, async (req, res) => {
  try {
    await pool.query(
      'UPDATE messages SET read = true WHERE id = $1 AND receiver_id = $2',
      [req.params.id, req.user.id]
    );
    
    res.json({ message: 'Message marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Announcements routes
router.get('/announcements', isAuthenticated, async (req, res) => {
  try {
    const grade = req.query.grade || req.user.grade;
    
    const announcements = await pool.query(
      `SELECT a.*, u.name as teacher_name
       FROM announcements a
       LEFT JOIN users u ON a.teacher_id = u.id
       WHERE a.grade = $1 OR a.grade IS NULL
       ORDER BY a.created_at DESC
       LIMIT 10`,
      [grade]
    );
    
    res.json(announcements.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/announcements', isTeacher, async (req, res) => {
  try {
    const { title, content, grade, priority } = req.body;
    
    const result = await pool.query(
      `INSERT INTO announcements (title, content, teacher_id, grade, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, content, req.user.id, grade, priority || 'normal']
    );
    
    // Send email to all students in the grade
    if (grade) {
      const students = await pool.query(
        'SELECT email FROM users WHERE role = $1 AND grade = $2',
        ['student', grade]
      );
      
      const emails = students.rows.map(s => s.email);
      // Send bulk email (implement bulk email logic)
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Leaderboard routes
router.get('/leaderboard', isAuthenticated, async (req, res) => {
  try {
    const { grade, timeframe } = req.query;
    
    let dateFilter = '';
    if (timeframe === 'week') {
      dateFilter = "AND lp.last_accessed >= NOW() - INTERVAL '7 days'";
    } else if (timeframe === 'month') {
      dateFilter = "AND lp.last_accessed >= NOW() - INTERVAL '30 days'";
    }
    
    const leaderboard = await pool.query(
      `SELECT 
        u.id, u.name, u.grade, u.profile_picture,
        COUNT(DISTINCT lp.lesson_id) as completed_lessons,
        SUM(lp.time_spent) as total_time,
        AVG(a.percentage) as avg_score,
        COUNT(DISTINCT ach.id) as achievements
       FROM users u
       LEFT JOIN lesson_progress lp ON u.id = lp.user_id AND lp.completed = true ${dateFilter}
       LEFT JOIN assessments a ON u.id = a.user_id
       LEFT JOIN achievements ach ON u.id = ach.user_id
       WHERE u.role = 'student' ${grade ? 'AND u.grade = $1' : ''}
       GROUP BY u.id
       ORDER BY completed_lessons DESC, avg_score DESC
       LIMIT 20`,
      grade ? [grade] : []
    );
    
    res.json(leaderboard.rows.map((row, index) => ({
      ...row,
      rank: index + 1
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reports generation
router.get('/reports/progress', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' && req.query.student_id 
      ? req.query.student_id 
      : req.user.id;
    
    const startDate = req.query.start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();
    
    const progressData = await pool.query(
      `SELECT 
        DATE(lp.last_accessed) as date,
        COUNT(DISTINCT lp.lesson_id) as lessons_accessed,
        SUM(lp.time_spent) as time_spent,
        AVG(lp.progress) as avg_progress
       FROM lesson_progress lp
       WHERE lp.user_id = $1 
         AND lp.last_accessed BETWEEN $2 AND $3
       GROUP BY DATE(lp.last_accessed)
       ORDER BY date`,
      [userId, startDate, endDate]
    );
    
    const assessmentData = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        AVG(percentage) as avg_score,
        COUNT(*) as assessments_taken
       FROM assessments
       WHERE user_id = $1 
         AND created_at BETWEEN $2 AND $3
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [userId, startDate, endDate]
    );
    
    res.json({
      progress: progressData.rows,
      assessments: assessmentData.rows,
      period: { start: startDate, end: endDate }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export student data (GDPR compliance)
router.get('/export/user-data', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const userData = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const progress = await pool.query('SELECT * FROM lesson_progress WHERE user_id = $1', [userId]);
    const assessments = await pool.query('SELECT * FROM assessments WHERE user_id = $1', [userId]);
    const achievements = await pool.query('SELECT * FROM achievements WHERE user_id = $1', [userId]);
    const skills = await pool.query(
      `SELECT s.*, sa.* 
       FROM skill_assignments sa
       JOIN skills s ON sa.skill_id = s.id
       WHERE sa.user_id = $1`,
      [userId]
    );
    
    const exportData = {
      user: userData.rows[0],
      progress: progress.rows,
      assessments: assessments.rows,
      achievements: achievements.rows,
      skills: skills.rows,
      exported_at: new Date().toISOString()
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="user-data.json"');
    res.json(exportData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search functionality
router.get('/search', isAuthenticated, async (req, res) => {
  try {
    const { q, type } = req.query;
    
    if (!q) {
      return res.json({ results: [] });
    }
    
    let results = {};
    
    if (!type || type === 'lessons') {
      const lessons = await pool.query(
        `SELECT id, title, grade, unit 
         FROM lessons 
         WHERE status = 'published' 
           AND (title ILIKE $1 OR content ILIKE $1)
         LIMIT 10`,
        [`%${q}%`]
      );
      results.lessons = lessons.rows;
    }
    
    if (!type || type === 'users') {
      const users = await pool.query(
        `SELECT id, name, email, role, grade 
         FROM users 
         WHERE name ILIKE $1 OR email ILIKE $1
         LIMIT 10`,
        [`%${q}%`]
      );
      results.users = users.rows;
    }
    
    if (!type || type === 'skills') {
      const skills = await pool.query(
        `SELECT id, name, description, grade 
         FROM skills 
         WHERE name ILIKE $1 OR description ILIKE $1
         LIMIT 10`,
        [`%${q}%`]
      );
      results.skills = skills.rows;
    }
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
