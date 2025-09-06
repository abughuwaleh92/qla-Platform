const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const natural = require('natural');
const mathjs = require('mathjs');
require('dotenv').config();

class AIService {
  constructor() {
    // Initialize AI providers
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    // Initialize NLP tools
    this.tokenizer = new natural.WordTokenizer();
    this.sentiment = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
    this.tfidf = new natural.TfIdf();
    
    // Math expression parser
    this.mathParser = mathjs.parser();
  }

  /**
   * Generate personalized lesson content based on student's learning style
   */
  async generatePersonalizedContent(student, topic, difficulty) {
    try {
      const prompt = `
        Create a personalized mathematics lesson for a Grade ${student.grade} student.
        Topic: ${topic}
        Difficulty: ${difficulty}
        Student's learning style: ${student.learning_style || 'visual'}
        Previous performance: ${student.avg_score}% average
        
        Generate:
        1. Brief introduction (2-3 sentences)
        2. Main concept explanation with examples
        3. 3 practice problems with increasing difficulty
        4. Real-world application
        
        Format as JSON with keys: introduction, concept, examples, practice_problems, application
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are an expert mathematics teacher creating personalized content for Qatar Leadership Academy students.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('AI content generation error:', error);
      return this.getFallbackContent(topic, difficulty);
    }
  }

  /**
   * Provide intelligent tutoring and hint generation
   */
  async generateHint(problem, studentAttempt, attemptNumber) {
    try {
      const prompt = `
        A student is solving: ${problem.question}
        Correct answer: ${problem.correct_answer}
        Student's attempt: ${studentAttempt}
        This is attempt #${attemptNumber}
        
        Provide a helpful hint that guides without giving away the answer.
        Be encouraging and pedagogical.
        
        Format: { hint: "...", encouragement: "...", strategy: "..." }
      `;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 500,
        messages: [
          { role: 'user', content: prompt }
        ]
      });

      return JSON.parse(response.content[0].text);
    } catch (error) {
      console.error('Hint generation error:', error);
      return this.getProgressiveHint(problem, attemptNumber);
    }
  }

  /**
   * Analyze student's problem-solving approach
   */
  async analyzeSolution(problem, studentSolution, timeTaken) {
    try {
      const analysis = {
        correct: false,
        efficiency: 0,
        understanding: 0,
        misconceptions: [],
        strengths: [],
        recommendations: []
      };

      // Check correctness
      const correct = this.checkMathAnswer(studentSolution, problem.correct_answer);
      analysis.correct = correct;

      // Analyze approach
      const prompt = `
        Analyze this student's solution:
        Problem: ${problem.question}
        Student's solution: ${studentSolution}
        Time taken: ${timeTaken} seconds
        Correct answer: ${problem.correct_answer}
        
        Identify:
        1. Misconceptions or errors
        2. Strengths in their approach
        3. Recommendations for improvement
        
        Format as JSON with keys: misconceptions[], strengths[], recommendations[]
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are analyzing student mathematics work to provide constructive feedback.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      });

      const aiAnalysis = JSON.parse(response.choices[0].message.content);
      
      return {
        ...analysis,
        ...aiAnalysis,
        efficiency: this.calculateEfficiency(timeTaken, problem.expected_time),
        understanding: this.estimateUnderstanding(correct, timeTaken, attemptNumber)
      };
    } catch (error) {
      console.error('Solution analysis error:', error);
      return this.basicAnalysis(problem, studentSolution, timeTaken);
    }
  }

  /**
   * Generate adaptive quiz questions based on student performance
   */
  async generateAdaptiveQuestions(student, topic, count = 5) {
    try {
      const performanceData = await this.getStudentPerformance(student.id);
      
      const prompt = `
        Generate ${count} mathematics questions for Grade ${student.grade}.
        Topic: ${topic}
        Student's current level: ${performanceData.level}
        Recent errors: ${performanceData.common_errors.join(', ')}
        
        Questions should:
        - Progress from current level
        - Address identified weaknesses
        - Include variety in problem types
        
        Format as JSON array with each question having:
        { 
          question: "...", 
          options: ["a", "b", "c", "d"], 
          correct: 0-3,
          explanation: "...",
          difficulty: "easy|medium|hard",
          skills: ["skill1", "skill2"],
          points: 10
        }
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are creating adaptive assessment questions for mathematics learning.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 3000
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Adaptive question generation error:', error);
      return this.getDefaultQuestions(topic, count);
    }
  }

  /**
   * Natural language question answering for student queries
   */
  async answerStudentQuestion(question, context) {
    try {
      // Check if it's a math problem
      if (this.isMathProblem(question)) {
        return this.solveMathProblem(question);
      }

      // General question answering
      const prompt = `
        A Grade ${context.grade} student asks: "${question}"
        Current lesson: ${context.lesson_title}
        Topic: ${context.topic}
        
        Provide a clear, age-appropriate explanation.
        Include an example if helpful.
        Keep it concise but complete.
      `;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 1000,
        messages: [
          { 
            role: 'user', 
            content: prompt 
          }
        ]
      });

      return {
        answer: response.content[0].text,
        related_topics: this.extractRelatedTopics(question),
        suggested_resources: await this.findRelatedResources(question, context)
      };
    } catch (error) {
      console.error('Question answering error:', error);
      return {
        answer: "I'm having trouble understanding your question. Could you please rephrase it or ask your teacher for help?",
        error: true
      };
    }
  }

  /**
   * Generate detailed feedback for assessments
   */
  async generateAssessmentFeedback(assessment, questions, answers) {
    try {
      const feedback = {
        overall: '',
        strengths: [],
        areas_for_improvement: [],
        question_feedback: [],
        next_steps: [],
        estimated_mastery: 0
      };

      // Analyze each question
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const answer = answers[i];
        
        const qFeedback = await this.analyzeQuestionResponse(question, answer);
        feedback.question_feedback.push(qFeedback);
      }

      // Generate overall feedback
      const prompt = `
        Generate comprehensive feedback for a student assessment:
        Score: ${assessment.percentage}%
        Questions answered: ${questions.length}
        Time taken: ${Math.round(assessment.time_taken / 60)} minutes
        
        Question-level performance:
        ${feedback.question_feedback.map((qf, i) => 
          `Q${i+1}: ${qf.correct ? '✓' : '✗'} - ${qf.skill}`
        ).join('\n')}
        
        Provide:
        1. Overall performance summary
        2. Key strengths (2-3 points)
        3. Areas for improvement (2-3 points)
        4. Specific next steps for learning
        5. Estimated mastery level (0-100)
        
        Be encouraging and constructive.
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are providing detailed, constructive feedback on student assessments.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.6
      });

      const aiFeedback = JSON.parse(response.choices[0].message.content);
      
      return {
        ...feedback,
        ...aiFeedback,
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Feedback generation error:', error);
      return this.getBasicFeedback(assessment);
    }
  }

  /**
   * Recommend learning path based on performance
   */
  async recommendLearningPath(student, recentPerformance) {
    try {
      const recommendations = {
        immediate_focus: [],
        suggested_lessons: [],
        practice_areas: [],
        estimated_time: 0,
        learning_style_tips: []
      };

      const prompt = `
        Based on student performance data:
        Grade: ${student.grade}
        Recent scores: ${recentPerformance.scores.join(', ')}
        Weak areas: ${recentPerformance.weak_skills.join(', ')}
        Strong areas: ${recentPerformance.strong_skills.join(', ')}
        Learning pace: ${recentPerformance.pace}
        
        Recommend:
        1. Top 3 immediate focus areas
        2. Specific lessons to review/advance
        3. Practice problem types
        4. Estimated time to improve
        5. Learning strategy tips
        
        Format as JSON matching the structure provided.
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are an educational advisor creating personalized learning paths.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Learning path recommendation error:', error);
      return this.getDefaultLearningPath(student.grade);
    }
  }

  /**
   * Detect learning patterns and predict performance
   */
  async predictPerformance(student, upcomingTopics) {
    try {
      // Get historical data
      const history = await this.getStudentHistory(student.id);
      
      // Analyze patterns
      const patterns = this.analyzeLearnin gPatterns(history);
      
      // Predict performance for upcoming topics
      const predictions = {};
      
      for (const topic of upcomingTopics) {
        const similarTopics = this.findSimilarTopics(topic, history);
        const avgPerformance = this.calculateAveragePerformance(similarTopics);
        const trend = this.calculateTrend(history);
        
        predictions[topic] = {
          expected_score: avgPerformance + trend,
          confidence: this.calculateConfidence(similarTopics.length),
          risk_areas: this.identifyRiskAreas(topic, patterns),
          preparation_needed: this.estimatePreparationTime(topic, patterns)
        };
      }

      return {
        predictions,
        overall_trend: patterns.trend,
        learning_velocity: patterns.velocity,
        recommendations: await this.generatePredictiveRecommendations(predictions)
      };
    } catch (error) {
      console.error('Performance prediction error:', error);
      return null;
    }
  }

  /**
   * Generate practice problems with step-by-step solutions
   */
  async generatePracticeWithSolutions(topic, difficulty, count = 5) {
    try {
      const problems = [];
      
      const prompt = `
        Generate ${count} mathematics practice problems with detailed solutions.
        Topic: ${topic}
        Difficulty: ${difficulty}
        
        For each problem provide:
        1. Clear problem statement
        2. Step-by-step solution
        3. Common mistakes to avoid
        4. Alternative approaches (if applicable)
        
        Format as JSON array with structure:
        {
          problem: "...",
          solution_steps: ["step1", "step2", ...],
          final_answer: "...",
          common_mistakes: ["mistake1", ...],
          alternatives: ["approach1", ...],
          hints: ["hint1", "hint2", ...],
          difficulty_rating: 1-5
        }
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are creating detailed mathematics practice problems with solutions.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9,
        max_tokens: 4000
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Practice generation error:', error);
      return this.getDefaultPracticeProblems(topic, count);
    }
  }

  /**
   * Provide real-time assistance during problem solving
   */
  async provideRealtimeAssistance(problem, currentWork, stuckPoint) {
    try {
      const assistance = {
        next_step: '',
        explanation: '',
        visual_aid: null,
        similar_example: null,
        checkpoint: false
      };

      const prompt = `
        Student is solving: ${problem}
        Current work: ${currentWork}
        Stuck at: ${stuckPoint}
        
        Provide immediate help:
        1. What's the next step?
        2. Why this step?
        3. Similar simpler example
        4. Is their work correct so far?
        
        Be concise and helpful without solving it completely.
      `;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 600,
        messages: [
          { role: 'user', content: prompt }
        ]
      });

      return JSON.parse(response.content[0].text);
    } catch (error) {
      console.error('Realtime assistance error:', error);
      return {
        next_step: 'Try breaking down the problem into smaller parts.',
        explanation: 'Sometimes complex problems become easier when we solve them step by step.'
      };
    }
  }

  // Helper methods
  
  checkMathAnswer(studentAnswer, correctAnswer) {
    try {
      const student = this.mathParser.evaluate(studentAnswer.toString());
      const correct = this.mathParser.evaluate(correctAnswer.toString());
      return Math.abs(student - correct) < 0.0001;
    } catch {
      return studentAnswer.toString().trim() === correctAnswer.toString().trim();
    }
  }

  isMathProblem(question) {
    const mathKeywords = ['solve', 'calculate', 'find', 'evaluate', 'simplify', 'factor', 'expand'];
    const mathSymbols = ['+', '-', '*', '/', '=', '^', '√', '∫', '∑'];
    
    const hasKeyword = mathKeywords.some(keyword => 
      question.toLowerCase().includes(keyword)
    );
    const hasSymbol = mathSymbols.some(symbol => 
      question.includes(symbol)
    );
    
    return hasKeyword || hasSymbol;
  }

  async solveMathProblem(problem) {
    try {
      // Extract mathematical expression
      const expression = this.extractMathExpression(problem);
      
      // Solve using math.js
      const solution = this.mathParser.evaluate(expression);
      
      // Generate explanation
      const explanation = await this.generateSolutionExplanation(problem, expression, solution);
      
      return {
        problem: problem,
        expression: expression,
        solution: solution,
        explanation: explanation,
        confidence: 0.95
      };
    } catch (error) {
      return {
        error: 'Unable to solve this problem automatically',
        suggestion: 'Please consult your teacher or try breaking it down into steps'
      };
    }
  }

  extractMathExpression(problem) {
    // Remove words and extract math expression
    let expression = problem;
    
    // Common word-to-symbol replacements
    const replacements = {
      'plus': '+',
      'minus': '-',
      'times': '*',
      'multiplied by': '*',
      'divided by': '/',
      'equals': '=',
      'squared': '^2',
      'cubed': '^3',
      'square root of': 'sqrt'
    };
    
    for (const [word, symbol] of Object.entries(replacements)) {
      expression = expression.replace(new RegExp(word, 'gi'), symbol);
    }
    
    // Extract numbers and operators
    const mathPattern = /[\d\+\-\*\/\^\(\)\.]+/g;
    const matches = expression.match(mathPattern);
    
    return matches ? matches.join('') : expression;
  }

  calculateEfficiency(actualTime, expectedTime) {
    if (!expectedTime) return 0.5;
    const ratio = actualTime / expectedTime;
    if (ratio <= 1) return 1;
    if (ratio <= 1.5) return 0.8;
    if (ratio <= 2) return 0.6;
    return 0.4;
  }

  estimateUnderstanding(correct, timeTaken, attempts) {
    let score = correct ? 1 : 0;
    
    // Adjust for attempts
    score *= Math.pow(0.9, attempts - 1);
    
    // Adjust for time (assuming average time is 60 seconds)
    if (timeTaken < 30) score *= 0.9; // Too fast might indicate guessing
    if (timeTaken > 180) score *= 0.95; // Too slow might indicate struggle
    
    return Math.max(0, Math.min(1, score));
  }

  getProgressiveHint(problem, attemptNumber) {
    const hints = [
      { 
        hint: 'Read the problem carefully. What is it asking for?',
        encouragement: 'You can do this!',
        strategy: 'Identify what you know and what you need to find.'
      },
      {
        hint: 'Try breaking the problem into smaller steps.',
        encouragement: 'You\'re making progress!',
        strategy: 'Write down the formula or rule that applies here.'
      },
      {
        hint: 'Check your calculations step by step.',
        encouragement: 'Almost there!',
        strategy: 'Sometimes a small error can lead to the wrong answer.'
      }
    ];
    
    return hints[Math.min(attemptNumber - 1, hints.length - 1)];
  }

  async getStudentPerformance(studentId) {
    // This would fetch from database
    return {
      level: 'intermediate',
      common_errors: ['sign errors', 'order of operations'],
      strong_areas: ['basic arithmetic', 'fractions'],
      weak_areas: ['word problems', 'algebra']
    };
  }

  extractRelatedTopics(question) {
    // Use NLP to extract topics
    const tokens = this.tokenizer.tokenize(question.toLowerCase());
    const mathTopics = {
      'fraction': ['fractions', 'ratios', 'proportions'],
      'equation': ['algebra', 'variables', 'solving'],
      'geometry': ['shapes', 'area', 'perimeter'],
      'graph': ['coordinate plane', 'plotting', 'functions']
    };
    
    const related = [];
    for (const [key, topics] of Object.entries(mathTopics)) {
      if (tokens.includes(key)) {
        related.push(...topics);
      }
    }
    
    return [...new Set(related)];
  }

  async findRelatedResources(question, context) {
    // This would search the database for related lessons
    return [
      { type: 'lesson', title: 'Related Lesson 1', id: 'lesson_1' },
      { type: 'video', title: 'Helpful Video', url: 'video_url' },
      { type: 'practice', title: 'Practice Problems', id: 'practice_1' }
    ];
  }

  // Fallback methods for error cases
  
  getFallbackContent(topic, difficulty) {
    return {
      introduction: `Let's learn about ${topic} today.`,
      concept: `${topic} is an important mathematical concept.`,
      examples: ['Example 1', 'Example 2'],
      practice_problems: [
        { question: 'Practice problem 1', answer: 'Answer 1' },
        { question: 'Practice problem 2', answer: 'Answer 2' },
        { question: 'Practice problem 3', answer: 'Answer 3' }
      ],
      application: `${topic} is used in many real-world situations.`
    };
  }

  getDefaultQuestions(topic, count) {
    const questions = [];
    for (let i = 0; i < count; i++) {
      questions.push({
        question: `Question ${i + 1} about ${topic}`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correct: Math.floor(Math.random() * 4),
        explanation: 'This is the correct answer because...',
        difficulty: ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)],
        skills: [topic],
        points: 10
      });
    }
    return questions;
  }

  getBasicFeedback(assessment) {
    return {
      overall: `You scored ${assessment.percentage}%. ${assessment.passed ? 'Well done!' : 'Keep practicing!'}`,
      strengths: assessment.percentage > 70 ? ['Good understanding shown'] : [],
      areas_for_improvement: assessment.percentage < 70 ? ['Review the lesson material'] : [],
      question_feedback: [],
      next_steps: ['Continue to the next lesson', 'Practice more problems'],
      estimated_mastery: assessment.percentage
    };
  }

  getDefaultLearningPath(grade) {
    return {
      immediate_focus: ['Review recent lessons', 'Practice basic problems'],
      suggested_lessons: [`Grade ${grade} fundamentals`],
      practice_areas: ['Basic arithmetic', 'Problem solving'],
      estimated_time: 60,
      learning_style_tips: ['Take breaks every 20 minutes', 'Use visual aids']
    };
  }

  getDefaultPracticeProblems(topic, count) {
    const problems = [];
    for (let i = 0; i < count; i++) {
      problems.push({
        problem: `Practice problem ${i + 1} for ${topic}`,
        solution_steps: ['Step 1', 'Step 2', 'Step 3'],
        final_answer: 'Answer',
        common_mistakes: ['Common mistake 1'],
        alternatives: [],
        hints: ['Hint 1', 'Hint 2'],
        difficulty_rating: 3
      });
    }
    return problems;
  }
}

module.exports = new AIService();
