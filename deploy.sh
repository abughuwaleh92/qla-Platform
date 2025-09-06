#!/bin/bash

# QLA LMS Deployment Script for Railway
# This script automates the deployment process

set -e

echo "🚀 Starting QLA LMS Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

if ! command_exists npm; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

if ! command_exists git; then
    echo -e "${RED}❌ Git is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites met${NC}"

# Check Node version
NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version must be 18 or higher${NC}"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create required directories
echo "📁 Creating required directories..."
mkdir -p uploads
mkdir -p public/lessons/grade7
mkdir -p public/lessons/grade8

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from template...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}Please edit .env with your configuration values${NC}"
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Check required environment variables
required_vars=(
    "DATABASE_URL"
    "GOOGLE_CLIENT_ID"
    "GOOGLE_CLIENT_SECRET"
    "SESSION_SECRET"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}❌ Required environment variable $var is not set${NC}"
        exit 1
    fi
done

# Run database migrations
echo "🗄️  Running database migrations..."
npm run migrate

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Database migration failed${NC}"
    exit 1
fi

# Build assets (if needed)
if [ -f "webpack.config.js" ]; then
    echo "🔨 Building assets..."
    npm run build
fi

# Run tests (if available)
if [ -f "test" ] || [ -d "tests" ]; then
    echo "🧪 Running tests..."
    npm test
fi

# Copy lesson files
echo "📚 Copying lesson files..."
if [ -d "lessons" ]; then
    cp -r lessons/* public/lessons/
fi

# Set up Railway deployment
if command_exists railway; then
    echo "🚂 Deploying to Railway..."
    
    # Check if logged in to Railway
    if ! railway whoami > /dev/null 2>&1; then
        echo -e "${YELLOW}Please login to Railway:${NC}"
        railway login
    fi
    
    # Link to project (if not already linked)
    if [ ! -f ".railway/config.json" ]; then
        echo "Linking to Railway project..."
        railway link
    fi
    
    # Deploy
    railway up
    
    # Get deployment URL
    DEPLOY_URL=$(railway status --json | jq -r '.url')
    
    if [ ! -z "$DEPLOY_URL" ]; then
        echo -e "${GREEN}✅ Deployment successful!${NC}"
        echo -e "🌐 Application URL: ${GREEN}$DEPLOY_URL${NC}"
    fi
else
    echo -e "${YELLOW}Railway CLI not installed. To deploy to Railway:${NC}"
    echo "1. Install Railway CLI: npm install -g @railway/cli"
    echo "2. Run: railway login"
    echo "3. Run: railway link"
    echo "4. Run: railway up"
fi

# Start application locally (optional)
read -p "Do you want to start the application locally? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Starting application..."
    npm start
fi

echo -e "${GREEN}✅ Deployment script completed!${NC}"
