const request = require('supertest');
const { expect } = require('chai');
const sinon = require('sinon');
const app = require('../server');
const { Pool } = require('pg');
const emailService = require('../services/emailService');

// Test database configuration
const testPool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/qla_lms_test'
});

describe('QLA LMS Test Suite', () => {
  let authToken;
  let testUser;
  let testLesson;

  // Setup before all tests
  before(async () => {
    // Run migrations on test database
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'student',
        grade INTEGER DEFAULT 7,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create test user
    const userResult = await testPool.query(
      `INSERT INTO users (email, name, role, grade) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      ['test@qla.qfschools.qa', 'Test User', 'student', 7]
    );
    testUser = userResult.rows[0];
  });

  // Cleanup after all tests
  after(async () => {
    await testPool.query('DROP TABLE IF EXISTS users CASCADE');
    await testPool.end();
  });

  describe('Authentication Tests', () => {
    it('should redirect to Google OAuth when accessing protected route', async () => {
      const res = await request(app)
        .get('/api/lessons')
        .expect(401);
      
      expect(res.body).to.have.property('error', 'Not authenticated');
    });

    it('should reject non-QLA email domains', async () => {
      const res = await request(app)
        .post('/auth/validate-email')
        .send({ email: 'user@gmail.com' })
        .expect(403);
      
      expect(res.body).to.have.property('error', 'Only QLA email addresses are allowed');
    });

    it('should accept QLA email domains', async () => {
      const res = await request(app)
        .post('/auth/validate-email')
        .send({ email: 'student@qla.qfschools.qa' })
        .expect(200);
      
      expect(res.body).to.have.property('valid', true);
    });

    it('should handle OAuth callback correctly', async () => {
      // Mock OAuth callback
      const res = await request(app)
        .get('/auth/google/callback')
        .query({ code: 'mock_auth_code' })
        .expect(302);
      
      expect(res.headers.location).to.equal('/dashboard');
    });
  });

  describe('Lesson Management Tests', () => {
    beforeEach(async () => {
      // Mock authentication
      authToken = 'mock_auth_token';
    });

    it('should create a new lesson (teacher only)', async () => {
      const lessonData = {
        title: 'Test Lesson',
        grade: 7,
        unit: 1,
        lesson_order: 0,
        content: 'Test content',
        practice_problems: [],
        assessment_questions: []
      };

      const res = await request(app)
        .post('/api/lessons')
        .set('Authorization', `Bearer ${authToken}`)
        .send(lessonData)
        .expect(200);
      
      expect(res.body).to.have.property('id');
      expect(res.body.title).to.equal('Test Lesson');
      testLesson = res.body;
    });

    it('should retrieve lesson list', async () => {
      const res = await request(app)
        .get('/api/lessons')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.at.least(1);
    });

    it('should get specific lesson with progress', async () => {
      const res = await request(app)
        .get(`/api/lessons/${testLesson.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body).to.have.property('title');
      expect(res.body).to.have.property('user_progress');
    });

    it('should update lesson (teacher only)', async () => {
      const updates = {
        title: 'Updated Test Lesson',
        status: 'published'
      };

      const res = await request(app)
        .put(`/api/lessons/${testLesson.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updates)
        .expect(200);
      
      expect(res.body.title).to.equal('Updated Test Lesson');
      expect(res.body.status).to.equal('published');
    });

    it('should handle invalid lesson ID', async () => {
      const res = await request(app)
        .get('/api/lessons/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
      
      expect(res.body).to.have.property('error', 'Lesson not found');
    });
  });

  describe('Assessment Tests', () => {
    it('should submit assessment and calculate score', async () => {
      const assessmentData = {
        lesson_id: testLesson.id,
        answers: [0, 1, 2, 3],
        time_taken: 300
      };

      const res = await request(app)
        .post('/api/assessments/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send(assessmentData)
        .expect(200);
      
      expect(res.body).to.have.property('score');
      expect(res.body).to.have.property('percentage');
      expect(res.body).to.have.property('passed');
    });

    it('should enforce 70% passing grade', async () => {
      const assessmentData = {
        lesson_id: testLesson.id,
        answers: [0, 0, 0, 0], // All wrong answers
        time_taken: 300
      };

      const res = await request(app)
        .post('/api/assessments/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send(assessmentData)
        .expect(200);
      
      expect(res.body.passed).to.equal(false);
      expect(res.body.percentage).to.be.below(70);
    });

    it('should retrieve assessment history', async () => {
      const res = await request(app)
        .get('/api/assessments/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body).to.be.an('array');
    });
  });

  describe('Progress Tracking Tests', () => {
    it('should update lesson progress', async () => {
      const progressData = {
        lesson_id: testLesson.id,
        progress: 50,
        time_spent: 600,
        video_progress: 75,
        completed: false
      };

      const res = await request(app)
        .post('/api/progress/lesson')
        .set('Authorization', `Bearer ${authToken}`)
        .send(progressData)
        .expect(200);
      
      expect(res.body.progress).to.equal(50);
      expect(res.body.video_progress).to.equal(75);
    });

    it('should get progress overview', async () => {
      const res = await request(app)
        .get('/api/progress/overview')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body).to.have.property('completed_lessons');
      expect(res.body).to.have.property('total_lessons');
      expect(res.body).to.have.property('total_study_time');
      expect(res.body).to.have.property('average_score');
    });
  });

  describe('Skills Management Tests', () => {
    let testSkill;

    it('should create new skill (teacher only)', async () => {
      const skillData = {
        name: 'Fraction Operations',
        description: 'Master addition and subtraction of fractions',
        grade: 7,
        difficulty: 'intermediate',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      };

      const res = await request(app)
        .post('/api/skills')
        .set('Authorization', `Bearer ${authToken}`)
        .send(skillData)
        .expect(200);
      
      expect(res.body).to.have.property('id');
      expect(res.body.name).to.equal('Fraction Operations');
      testSkill = res.body;
    });

    it('should assign skill to students', async () => {
      const assignmentData = {
        student_ids: [testUser.id]
      };

      const res = await request(app)
        .post(`/api/skills/${testSkill.id}/assign`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(assignmentData)
        .expect(200);
      
      expect(res.body).to.have.property('assigned_count', 1);
    });

    it('should update skill progress (student)', async () => {
      const progressData = {
        progress: 75,
        status: 'in_progress'
      };

      const res = await request(app)
        .put(`/api/skills/${testSkill.id}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(progressData)
        .expect(200);
      
      expect(res.body.progress).to.equal(75);
      expect(res.body.status).to.equal('in_progress');
    });
  });

  describe('Email Service Tests', () => {
    let emailStub;

    beforeEach(() => {
      emailStub = sinon.stub(emailService, 'sendEmail').resolves({ success: true });
    });

    afterEach(() => {
      emailStub.restore();
    });

    it('should send welcome email to new user', async () => {
      await emailService.sendWelcomeEmail(testUser);
      
      expect(emailStub.calledOnce).to.be.true;
      expect(emailStub.firstCall.args[0]).to.equal(testUser.email);
      expect(emailStub.firstCall.args[1]).to.include('Welcome');
    });

    it('should send assessment completion email', async () => {
      const assessment = {
        percentage: 85,
        passed: true,
        score: 85,
        total_points: 100,
        time_taken: 600
      };

      await emailService.sendAssessmentComplete(testUser, assessment, testLesson);
      
      expect(emailStub.calledOnce).to.be.true;
      expect(emailStub.firstCall.args[1]).to.include('Assessment Completed');
    });

    it('should send skill assignment notification', async () => {
      const skill = {
        name: 'Test Skill',
        description: 'Test description',
        difficulty: 'easy'
      };

      await emailService.sendSkillAssignment(testUser, skill, { name: 'Teacher Name' });
      
      expect(emailStub.calledOnce).to.be.true;
      expect(emailStub.firstCall.args[1]).to.include('New Skill Assigned');
    });
  });

  describe('Analytics Tests', () => {
    it('should generate class analytics (teacher)', async () => {
      const res = await request(app)
        .get('/api/analytics/class')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ grade: 7 })
        .expect(200);
      
      expect(res.body).to.have.property('total_students');
      expect(res.body).to.have.property('avg_progress');
      expect(res.body).to.have.property('total_study_time');
      expect(res.body).to.have.property('avg_assessment_score');
    });

    it('should get student analytics', async () => {
      const res = await request(app)
        .get('/api/analytics/students')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body).to.be.an('array');
      if (res.body.length > 0) {
        expect(res.body[0]).to.have.property('name');
        expect(res.body[0]).to.have.property('completed_lessons');
        expect(res.body[0]).to.have.property('avg_progress');
      }
    });

    it('should generate progress report', async () => {
      const res = await request(app)
        .get('/api/reports/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end_date: new Date().toISOString()
        })
        .expect(200);
      
      expect(res.body).to.have.property('progress');
      expect(res.body).to.have.property('assessments');
      expect(res.body).to.have.property('period');
    });
  });

  describe('WebSocket Tests', () => {
    const io = require('socket.io-client');
    let socket;

    beforeEach((done) => {
      socket = io('http://localhost:3000', {
        transports: ['websocket'],
        auth: { token: authToken }
      });
      socket.on('connect', done);
    });

    afterEach(() => {
      if (socket.connected) {
        socket.disconnect();
      }
    });

    it('should join lesson room', (done) => {
      socket.emit('join-lesson', testLesson.id);
      socket.on('joined-lesson', (data) => {
        expect(data.lessonId).to.equal(testLesson.id);
        done();
      });
    });

    it('should broadcast lesson progress', (done) => {
      const progressData = {
        lessonId: testLesson.id,
        progress: 60,
        userId: testUser.id
      };

      socket.emit('lesson-progress', progressData);
      socket.on('student-progress', (data) => {
        expect(data.progress).to.equal(60);
        done();
      });
    });

    it('should handle question asking', (done) => {
      const questionData = {
        lessonId: testLesson.id,
        question: 'What is the formula for area of a circle?',
        userId: testUser.id
      };

      socket.emit('question-asked', questionData);
      socket.on('new-question', (data) => {
        expect(data.question).to.include('area of a circle');
        done();
      });
    });
  });

  describe('Security Tests', () => {
    it('should prevent SQL injection', async () => {
      const maliciousInput = "'; DROP TABLE users; --";
      
      const res = await request(app)
        .get('/api/lessons')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: maliciousInput })
        .expect(200);
      
      // Should return empty results, not error
      expect(res.body).to.be.an('array');
    });

    it('should prevent XSS attacks', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          receiver_id: testUser.id,
          subject: xssPayload,
          content: xssPayload
        })
        .expect(200);
      
      // Content should be sanitized
      expect(res.body.subject).to.not.include('<script>');
      expect(res.body.content).to.not.include('<script>');
    });

    it('should enforce rate limiting', async () => {
      const requests = [];
      
      // Make 100 rapid requests
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app)
            .get('/api/lessons')
            .set('Authorization', `Bearer ${authToken}`)
        );
      }
      
      const results = await Promise.all(requests);
      const rateLimited = results.filter(r => r.status === 429);
      
      expect(rateLimited.length).to.be.above(0);
    });

    it('should validate file uploads', async () => {
      const res = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from('test'), 'test.exe')
        .expect(400);
      
      expect(res.body).to.have.property('error', 'Invalid file type');
    });
  });

  describe('Performance Tests', () => {
    it('should handle concurrent users', async () => {
      const concurrentRequests = 50;
      const requests = [];
      
      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(
          request(app)
            .get('/api/lessons')
            .set('Authorization', `Bearer ${authToken}`)
        );
      }
      
      const start = Date.now();
      const results = await Promise.all(requests);
      const duration = Date.now() - start;
      
      expect(results.every(r => r.status === 200)).to.be.true;
      expect(duration).to.be.below(5000); // Should complete within 5 seconds
    });

    it('should cache static resources', async () => {
      const res = await request(app)
        .get('/static/logo.png')
        .expect(200);
      
      expect(res.headers).to.have.property('cache-control');
      expect(res.headers['cache-control']).to.include('max-age');
    });
  });

  describe('Data Export Tests', () => {
    it('should export user data (GDPR compliance)', async () => {
      const res = await request(app)
        .get('/api/export/user-data')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.headers['content-type']).to.include('application/json');
      expect(res.headers['content-disposition']).to.include('attachment');
      expect(res.body).to.have.property('user');
      expect(res.body).to.have.property('progress');
      expect(res.body).to.have.property('assessments');
    });
  });
});

// Integration test runner
if (require.main === module) {
  const Mocha = require('mocha');
  const mocha = new Mocha({
    reporter: 'spec',
    timeout: 10000
  });
  
  mocha.run((failures) => {
    process.exitCode = failures ? 1 : 0;
  });
}
