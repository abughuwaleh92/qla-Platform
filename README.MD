# QLA Mathematics Learning Management System

A comprehensive, interactive LMS platform for Qatar Leadership Academy with Google authentication, video lessons, interactive slides, assessments, and progress tracking.

## 🚀 Features

- **Google OAuth Authentication** (restricted to @qla.qfschools.qa domain)
- **Dual Portal System** (Student & Teacher)
- **Interactive Lesson Slides** with KaTeX math rendering
- **Video Integration** with progress tracking
- **Assessment System** with automatic grading
- **Practice Problems** with instant feedback
- **Skills Management** and assignment tracking
- **Real-time Progress Monitoring**
- **Analytics Dashboard** for teachers
- **WebSocket Support** for live interactions
- **Mobile Responsive Design**

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Google Cloud Console account
- Railway account for deployment

## 🔧 Local Development Setup

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/qla-lms.git
cd qla-lms
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up PostgreSQL Database
```bash
# Create a new database
createdb qla_lms_dev

# Run migrations
npm run migrate
```

### 4. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Google+ API
4. Go to Credentials → Create Credentials → OAuth Client ID
5. Choose "Web application"
6. Add authorized redirect URIs:
   - `http://localhost:3000/auth/google/callback` (development)
   - `https://your-app.up.railway.app/auth/google/callback` (production)
7. Copy Client ID and Client Secret

### 5. Set Up Environment Variables
```bash
# Copy the template
cp .env.example .env

# Edit .env with your values
nano .env
```

### 6. Create Required Directories
```bash
mkdir uploads
mkdir public/lessons
```

### 7. Copy Lesson Files
Place your Grade 7 and Grade 8 lesson HTML files in the appropriate directories:
```
public/
├── lessons/
│   ├── grade7/
│   │   └── lesson-*.html
│   └── grade8/
│       └── lesson-*.html
```

### 8. Start Development Server
```bash
npm run dev
```

Visit `http://localhost:3000`

## 🚢 Railway Deployment

### 1. Prepare Your Repository
```bash
# Initialize git if not already done
git init
git add .
git commit -m "Initial commit"

# Push to GitHub
git remote add origin https://github.com/your-username/qla-lms.git
git push -u origin main
```

### 2. Set Up Railway

1. Go to [Railway](https://railway.app)
2. Click "New Project"
3. Choose "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect Node.js

### 3. Add PostgreSQL Database

1. In Railway dashboard, click "New"
2. Select "Database" → "Add PostgreSQL"
3. Copy the DATABASE_URL from the PostgreSQL settings

### 4. Configure Environment Variables

In Railway project settings, add all variables from `.env`:

```
NODE_ENV=production
DATABASE_URL=[automatically set by Railway]
SESSION_SECRET=generate-a-long-random-string
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
CLIENT_URL=https://your-app.up.railway.app
ALLOWED_EMAIL_DOMAIN=@qla.qfschools.qa
```

### 5. Set Up Custom Domain (Optional)

1. In Railway settings, go to "Domains"
2. Add custom domain: `lms.qla.qfschools.qa`
3. Update DNS records as instructed
4. Update Google OAuth redirect URI

### 6. Deploy

```bash
# Push changes to trigger deployment
git add .
git commit -m "Configure for production"
git push origin main
```

Railway will automatically:
- Install dependencies
- Run database migrations
- Start the application

### 7. Run Initial Migration

In Railway, use the command palette or shell:
```bash
npm run migrate
```

## 📁 Project Structure

```
qla-lms/
├── server.js              # Express server & API routes
├── package.json           # Dependencies
├── railway.json          # Railway configuration
├── .env                  # Environment variables
├── migrations/
│   └── init.js          # Database schema
├── public/
│   ├── index.html       # Main application
│   ├── style.css        # Global styles
│   ├── app.js           # Frontend JavaScript
│   └── lessons/         # Interactive lesson files
├── uploads/             # User uploaded files
└── README.md           # Documentation
```

## 🔐 Security Configuration

### Google OAuth Domain Restriction

The system automatically restricts access to @qla.qfschools.qa emails. To modify:

```javascript
// In server.js, line ~85
if (!email.endsWith('@qla.qfschools.qa') && process.env.NODE_ENV === 'production') {
  return done(null, false, { message: 'Only QLA email addresses are allowed' });
}
```

### Session Security

Sessions are configured with:
- HTTPOnly cookies
- Secure flag in production
- 24-hour expiration
- Strong secret key

## 📊 Database Schema

### Main Tables:
- `users` - Student and teacher accounts
- `lessons` - Course content
- `lesson_progress` - Student progress tracking
- `assessments` - Quiz results
- `skills` - Learning objectives
- `skill_assignments` - Student skill tracking
- `interactive_slides` - Lesson slide data
- `messages` - Communication system
- `achievements` - Gamification elements

## 🎨 Customization

### Adding New Lessons

1. Create lesson HTML file following the template structure
2. Upload through teacher portal or add directly to database
3. Include interactive elements using data attributes

### Modifying Grade Levels

Edit the grade configuration in `public/app.js`:
```javascript
const gradeConfig = {
  7: { units: [...] },
  8: { units: [...] },
  // Add more grades
};
```

## 🧪 Testing

### Run Tests
```bash
npm test
```

### Test Student Account
- Email: student@qla.qfschools.qa
- Auto-enrolled in Grade 7

### Test Teacher Account  
- Email: teacher@qla.qfschools.qa
- Full admin access

## 📈 Monitoring

### Health Check Endpoint
```
GET /api/health
```

### Application Logs
Railway provides real-time logs in the dashboard.

### Error Tracking
Configure Sentry by adding `SENTRY_DSN` to environment variables.

## 🆘 Troubleshooting

### Database Connection Issues
- Verify DATABASE_URL is correct
- Check PostgreSQL is running
- Ensure SSL is configured for production

### Google OAuth Errors
- Verify redirect URIs match exactly
- Check client ID and secret
- Ensure Google+ API is enabled

### File Upload Issues
- Check `uploads/` directory exists and is writable
- Verify file size limits in configuration
- Ensure proper MIME types are allowed

## 📝 API Documentation

### Authentication
```
GET  /auth/google           - Initiate Google OAuth
GET  /auth/google/callback  - OAuth callback
GET  /auth/logout          - Logout user
GET  /api/auth/status      - Check auth status
```

### Lessons
```
GET    /api/lessons         - List all lessons
GET    /api/lessons/:id     - Get specific lesson
POST   /api/lessons         - Create lesson (teacher)
PUT    /api/lessons/:id     - Update lesson (teacher)
DELETE /api/lessons/:id     - Delete lesson (teacher)
```

### Progress
```
POST /api/progress/lesson   - Update lesson progress
GET  /api/progress/overview - Get progress summary
```

### Assessments
```
POST /api/assessments/submit  - Submit assessment
GET  /api/assessments/history - Get assessment history
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is proprietary to Qatar Leadership Academy.

## 📧 Support

For support, email: it-support@qla.qfschools.qa

## 🎯 Deployment Checklist

- [ ] Set up GitHub repository
- [ ] Configure Google OAuth credentials
- [ ] Create Railway project
- [ ] Add PostgreSQL database
- [ ] Configure environment variables
- [ ] Update OAuth redirect URIs
- [ ] Run database migrations
- [ ] Test authentication flow
- [ ] Verify lesson loading
- [ ] Check assessment functionality
- [ ] Test file uploads
- [ ] Configure custom domain
- [ ] Set up SSL certificate
- [ ] Enable error tracking
- [ ] Configure backups
- [ ] Document admin procedures

## 🔄 Update Procedure

1. Test changes locally
2. Push to staging branch
3. Test on staging environment
4. Merge to main branch
5. Railway auto-deploys
6. Verify production deployment

---

**Built with ❤️ for Qatar Leadership Academy**
