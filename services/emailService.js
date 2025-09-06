const nodemailer = require('nodemailer');
require('dotenv').config();

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async sendEmail(to, subject, html, attachments = []) {
    try {
      const mailOptions = {
        from: `"QLA Mathematics LMS" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html,
        attachments
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Email error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendWelcomeEmail(user) {
    const subject = 'Welcome to QLA Mathematics Learning Platform!';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #6C1D45, #8B2450); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #6C1D45; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to QLA Mathematics LMS!</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.name}!</h2>
            <p>Welcome to the Qatar Leadership Academy Mathematics Learning Management System. We're excited to have you join our learning community!</p>
            
            <h3>Getting Started:</h3>
            <ul>
              <li>Access your ${user.role === 'teacher' ? 'Teacher' : 'Student'} Portal</li>
              <li>${user.role === 'teacher' ? 'Create and manage lessons' : 'Explore Grade ' + user.grade + ' lessons'}</li>
              <li>${user.role === 'teacher' ? 'Track student progress' : 'Complete assessments and practice problems'}</li>
              <li>${user.role === 'teacher' ? 'Assign skills to students' : 'Track your learning progress'}</li>
            </ul>
            
            <center>
              <a href="${process.env.CLIENT_URL}/dashboard" class="button">Go to Dashboard</a>
            </center>
            
            <p>If you have any questions, please contact our support team at <a href="mailto:support@qla.qfschools.qa">support@qla.qfschools.qa</a></p>
          </div>
          <div class="footer">
            <p>© 2024 Qatar Leadership Academy. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(user.email, subject, html);
  }

  async sendAssessmentComplete(user, assessment, lesson) {
    const subject = `Assessment Completed: ${lesson.title}`;
    const passStatus = assessment.passed ? '✅ PASSED' : '❌ NOT PASSED';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: ${assessment.passed ? '#136f3a' : '#dc2626'}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px; }
          .score-box { background: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center; }
          .score { font-size: 48px; font-weight: bold; color: ${assessment.passed ? '#136f3a' : '#dc2626'}; }
          .details { display: flex; justify-content: space-around; margin: 20px 0; }
          .detail-item { text-align: center; }
          .detail-value { font-size: 24px; font-weight: bold; }
          .detail-label { color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${passStatus}</h1>
            <h2>${lesson.title}</h2>
          </div>
          <div class="content">
            <h2>Hi ${user.name},</h2>
            <p>You have completed the assessment for "${lesson.title}".</p>
            
            <div class="score-box">
              <div class="score">${assessment.percentage}%</div>
              <p>${assessment.passed ? 'Congratulations! You passed the assessment.' : 'You need 70% to pass. Keep practicing!'}</p>
            </div>
            
            <div class="details">
              <div class="detail-item">
                <div class="detail-value">${assessment.score}</div>
                <div class="detail-label">Points Earned</div>
              </div>
              <div class="detail-item">
                <div class="detail-value">${assessment.total_points}</div>
                <div class="detail-label">Total Points</div>
              </div>
              <div class="detail-item">
                <div class="detail-value">${Math.round(assessment.time_taken / 60)}m</div>
                <div class="detail-label">Time Taken</div>
              </div>
            </div>
            
            ${!assessment.passed ? `
              <h3>Next Steps:</h3>
              <ul>
                <li>Review the lesson materials</li>
                <li>Practice more problems</li>
                <li>Ask your teacher for help</li>
                <li>Retake the assessment when ready</li>
              </ul>
            ` : `
              <h3>Great Job!</h3>
              <p>You can now proceed to the next lesson in your learning journey.</p>
            `}
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(user.email, subject, html);
  }

  async sendSkillAssignment(student, skill, teacher) {
    const subject = `New Skill Assigned: ${skill.name}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #C7A34F; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px; }
          .skill-box { background: #f9f9f9; padding: 20px; border-left: 4px solid #C7A34F; margin: 20px 0; }
          .meta { color: #666; font-size: 14px; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Skill Assignment</h1>
          </div>
          <div class="content">
            <h2>Hello ${student.name},</h2>
            <p>${teacher.name} has assigned you a new skill to practice:</p>
            
            <div class="skill-box">
              <h3>${skill.name}</h3>
              <p>${skill.description}</p>
              <div class="meta">
                <p><strong>Difficulty:</strong> ${skill.difficulty}</p>
                <p><strong>Due Date:</strong> ${skill.due_date ? new Date(skill.due_date).toLocaleDateString() : 'No due date'}</p>
              </div>
            </div>
            
            <p>Log in to your student portal to start practicing this skill.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(student.email, subject, html);
  }

  async sendProgressReport(student, progressData) {
    const subject = 'Your Weekly Progress Report';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #6C1D45, #8B2450); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px; }
          .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
          .stat-card { background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; }
          .stat-value { font-size: 28px; font-weight: bold; color: #6C1D45; }
          .stat-label { color: #666; font-size: 14px; margin-top: 5px; }
          .progress-bar { background: #e0e0e0; height: 20px; border-radius: 10px; overflow: hidden; margin: 20px 0; }
          .progress-fill { background: linear-gradient(90deg, #C7A34F, #6C1D45); height: 100%; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Weekly Progress Report</h1>
            <p>Week of ${new Date().toLocaleDateString()}</p>
          </div>
          <div class="content">
            <h2>Great work this week, ${student.name}!</h2>
            
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progressData.overall_progress}%"></div>
            </div>
            <p style="text-align: center; color: #666;">Overall Progress: ${progressData.overall_progress}%</p>
            
            <div class="stat-grid">
              <div class="stat-card">
                <div class="stat-value">${progressData.lessons_completed}</div>
                <div class="stat-label">Lessons Completed</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${progressData.study_time}h</div>
                <div class="stat-label">Study Time</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${progressData.avg_score}%</div>
                <div class="stat-label">Average Score</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${progressData.skills_mastered}</div>
                <div class="stat-label">Skills Mastered</div>
              </div>
            </div>
            
            ${progressData.achievements && progressData.achievements.length > 0 ? `
              <h3>🏆 Achievements Earned:</h3>
              <ul>
                ${progressData.achievements.map(a => `<li>${a}</li>`).join('')}
              </ul>
            ` : ''}
            
            <p style="margin-top: 30px;">Keep up the excellent work! Your dedication to learning is inspiring.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(student.email, subject, html);
  }

  async sendTeacherNotification(teacher, type, data) {
    let subject, html;

    switch(type) {
      case 'low_engagement':
        subject = 'Student Engagement Alert';
        html = `
          <h2>Low Engagement Alert</h2>
          <p>The following students have not accessed the platform in the last 7 days:</p>
          <ul>
            ${data.students.map(s => `<li>${s.name} (Grade ${s.grade}) - Last active: ${s.last_active}</li>`).join('')}
          </ul>
        `;
        break;

      case 'assessment_results':
        subject = 'Assessment Results Summary';
        html = `
          <h2>Assessment Results for ${data.lesson_title}</h2>
          <p>Total Students: ${data.total_students}</p>
          <p>Passed: ${data.passed} (${data.pass_rate}%)</p>
          <p>Average Score: ${data.avg_score}%</p>
          <h3>Students Needing Support:</h3>
          <ul>
            ${data.failed_students.map(s => `<li>${s.name} - Score: ${s.score}%</li>`).join('')}
          </ul>
        `;
        break;

      default:
        return { success: false, error: 'Unknown notification type' };
    }

    return await this.sendEmail(teacher.email, subject, html);
  }
}

module.exports = new EmailService();
