/**
 * QLA Enhanced Lesson Bridge
 * Provides full interactive tracking and communication between lessons and the LMS platform
 */
(function() {
  const QLA_BRIDGE = {
    // Configuration
    config: {
      apiEndpoint: '/api',
      socketEndpoint: window.location.origin,
      progressInterval: 5000, // Save progress every 5 seconds
      interactionTimeout: 1000 // Debounce interactions
    },
    
    // State management
    state: {
      lessonId: null,
      userId: null,
      startTime: Date.now(),
      currentSlide: 1,
      totalSlides: 1,
      slideProgress: {},
      interactions: [],
      pendingInteractions: [],
      isTeacherMode: false,
      sessionCode: null,
      socket: null
    },
    
    // Initialize the bridge
    init() {
      console.log('🌉 QLA Lesson Bridge initializing...');
      
      // Extract lesson info from parent
      this.extractLessonInfo();
      
      // Set up WebSocket connection
      this.initSocket();
      
      // Detect and track slides
      this.detectSlides();
      
      // Set up interaction observers
      this.setupInteractionTracking();
      
      // Set up progress tracking
      this.startProgressTracking();
      
      // Set up message handlers
      this.setupMessageHandlers();
      
      // Initialize interactive elements
      this.enhanceInteractiveElements();
      
      console.log('✅ QLA Lesson Bridge ready');
    },
    
    // Extract lesson information from parent window
    extractLessonInfo() {
      try {
        // Try to get lesson ID from parent message
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'bridge-ready' }, '*');
        }
        
        // Try to extract from URL or data attributes
        const urlParams = new URLSearchParams(window.location.search);
        this.state.lessonId = urlParams.get('lesson_id') || 
                             document.body.dataset.lessonId || 
                             'unknown';
        
        this.state.isTeacherMode = urlParams.get('mode') === 'teacher' ||
                                   document.body.dataset.mode === 'teacher';
        
        this.state.sessionCode = urlParams.get('session') || 
                                document.body.dataset.session;
      } catch (e) {
        console.warn('Could not extract lesson info:', e);
      }
    },
    
    // Initialize WebSocket connection
    initSocket() {
      if (typeof io !== 'undefined') {
        try {
          this.state.socket = io(this.config.socketEndpoint);
          
          this.state.socket.on('connect', () => {
            console.log('✅ WebSocket connected');
            
            if (this.state.lessonId) {
              this.state.socket.emit('join-lesson', this.state.lessonId);
            }
            
            if (this.state.sessionCode) {
              this.state.socket.emit('join-classroom', this.state.sessionCode);
            }
          });
          
          // Listen for teacher controls in student mode
          if (!this.state.isTeacherMode) {
            this.state.socket.on('classroom-control', (data) => {
              this.handleTeacherControl(data);
            });
          }
        } catch (e) {
          console.warn('WebSocket initialization failed:', e);
        }
      }
    },
    
    // Detect and track slides
    detectSlides() {
      // Common slide selectors
      const slideSelectors = [
        '#slides > section',
        '.slide',
        'section[data-slide]',
        '.reveal .slides section',
        '[data-qla-slide]'
      ];
      
      let slides = [];
      for (const selector of slideSelectors) {
        slides = document.querySelectorAll(selector);
        if (slides.length > 0) break;
      }
      
      this.state.totalSlides = slides.length || 1;
      
      // Add tracking attributes
      slides.forEach((slide, index) => {
        slide.dataset.slideNumber = index + 1;
        slide.dataset.viewed = 'false';
        
        // Track when slide becomes visible
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
              this.onSlideView(index + 1);
            }
          });
        }, { threshold: 0.5 });
        
        observer.observe(slide);
      });
      
      console.log(`📊 Detected ${this.state.totalSlides} slides`);
    },
    
    // Handle slide view
    onSlideView(slideNumber) {
      const slide = document.querySelector(`[data-slide-number="${slideNumber}"]`);
      if (slide && slide.dataset.viewed !== 'true') {
        slide.dataset.viewed = 'true';
        this.state.currentSlide = slideNumber;
        this.state.slideProgress[slideNumber] = {
          viewed: true,
          viewedAt: Date.now(),
          timeSpent: 0,
          interactions: []
        };
        
        this.emitProgress({
          type: 'slide-view',
          slideNumber,
          totalSlides: this.state.totalSlides
        });
        
        // Update progress bar if exists
        this.updateProgressBar();
      }
    },
    
    // Set up interaction tracking
    setupInteractionTracking() {
      // Track all clicks on interactive elements
      document.addEventListener('click', (e) => {
        const target = e.target;
        
        // Check for interactive elements
        if (this.isInteractiveElement(target)) {
          this.trackInteraction('click', target);
        }
        
        // Check for answer selections
        if (target.matches('input[type="radio"], input[type="checkbox"]') ||
            target.closest('.answer-option, .quiz-option, .choice')) {
          this.trackAnswer(target);
        }
        
        // Check for completion triggers
        if (target.matches('[data-complete], .mark-complete, .finish, .complete, .submit-answer')) {
          this.markActivityComplete(target);
        }
      });
      
      // Track input changes
      document.addEventListener('change', (e) => {
        if (e.target.matches('input, select, textarea')) {
          this.trackInteraction('input', e.target);
        }
      });
      
      // Track drag and drop
      this.setupDragDropTracking();
      
      // Track math input
      this.setupMathTracking();
    },
    
    // Check if element is interactive
    isInteractiveElement(element) {
      const interactiveSelectors = [
        'button',
        'a[href]',
        '[role="button"]',
        '[data-interactive]',
        '.interactive',
        '[onclick]',
        '.draggable',
        '.droppable',
        'input',
        'select',
        'textarea'
      ];
      
      return interactiveSelectors.some(selector => 
        element.matches(selector) || element.closest(selector)
      );
    },
    
    // Track interaction
    trackInteraction(type, element, data = {}) {
      const interaction = {
        type,
        timestamp: Date.now(),
        slideNumber: this.state.currentSlide,
        elementType: element.tagName.toLowerCase(),
        elementId: element.id || element.dataset.id || null,
        elementClass: element.className,
        data: {
          ...data,
          text: element.textContent?.substring(0, 100),
          value: element.value || null
        }
      };
      
      this.state.interactions.push(interaction);
      this.state.pendingInteractions.push(interaction);
      
      // Debounce sending interactions
      clearTimeout(this.interactionTimer);
      this.interactionTimer = setTimeout(() => {
        this.sendInteractions();
      }, this.config.interactionTimeout);
      
      // Emit real-time event if in classroom mode
      if (this.state.socket && this.state.sessionCode) {
        this.state.socket.emit('lesson-interaction', {
          lessonId: this.state.lessonId,
          interaction
        });
      }
    },
    
    // Track answer selection
    trackAnswer(element) {
      const container = element.closest('.question, .quiz-question, .problem, [data-question]');
      const questionId = container?.dataset.questionId || container?.id;
      const answer = element.value || element.textContent;
      const isCorrect = element.dataset.correct === 'true' || 
                       element.classList.contains('correct');
      
      this.trackInteraction('answer', element, {
        questionId,
        answer,
        isCorrect
      });
      
      // Check if answer is correct and provide feedback
      if (isCorrect !== undefined) {
        this.provideFeedback(element, isCorrect);
      }
    },
    
    // Provide immediate feedback
    provideFeedback(element, isCorrect) {
      const feedback = document.createElement('div');
      feedback.className = `qla-feedback ${isCorrect ? 'correct' : 'incorrect'}`;
      feedback.innerHTML = `
        <i class="fas fa-${isCorrect ? 'check-circle' : 'times-circle'}"></i>
        ${isCorrect ? 'Correct!' : 'Try again'}
      `;
      
      // Style the feedback
      feedback.style.cssText = `
        position: absolute;
        padding: 8px 16px;
        background: ${isCorrect ? '#10b981' : '#ef4444'};
        color: white;
        border-radius: 8px;
        font-weight: 600;
        z-index: 1000;
        animation: fadeInOut 2s ease-in-out;
      `;
      
      // Position near the element
      const rect = element.getBoundingClientRect();
      feedback.style.left = `${rect.left}px`;
      feedback.style.top = `${rect.bottom + 5}px`;
      
      document.body.appendChild(feedback);
      
      setTimeout(() => {
        feedback.remove();
      }, 2000);
    },
    
    // Mark activity as complete
    markActivityComplete(element) {
      const activity = element.closest('.activity, .exercise, .problem, [data-activity]');
      const activityId = activity?.dataset.activityId || activity?.id;
      
      this.trackInteraction('complete', element, {
        activityId,
        activityType: activity?.dataset.type || 'unknown'
      });
      
      // Visual completion indicator
      if (activity) {
        activity.classList.add('completed');
        activity.dataset.completed = 'true';
      }
      
      // Check if all activities on slide are complete
      this.checkSlideCompletion();
      
      // Emit completion event
      this.emitProgress({
        type: 'activity-complete',
        activityId,
        slideNumber: this.state.currentSlide
      });
    },
    
    // Check if all activities on current slide are complete
    checkSlideCompletion() {
      const currentSlide = document.querySelector(`[data-slide-number="${this.state.currentSlide}"]`);
      if (!currentSlide) return;
      
      const activities = currentSlide.querySelectorAll('.activity, .exercise, .problem, [data-activity]');
      const completed = currentSlide.querySelectorAll('[data-completed="true"]');
      
      if (activities.length > 0 && activities.length === completed.length) {
        this.emitProgress({
          type: 'slide-complete',
          slideNumber: this.state.currentSlide,
          totalSlides: this.state.totalSlides
        });
        
        // Auto-advance if configured
        if (currentSlide.dataset.autoAdvance === 'true') {
          setTimeout(() => {
            this.navigateToSlide(this.state.currentSlide + 1);
          }, 2000);
        }
      }
    },
    
    // Set up drag and drop tracking
    setupDragDropTracking() {
      let draggedElement = null;
      
      document.addEventListener('dragstart', (e) => {
        if (e.target.draggable || e.target.classList.contains('draggable')) {
          draggedElement = e.target;
          this.trackInteraction('drag-start', e.target);
        }
      });
      
      document.addEventListener('drop', (e) => {
        if (e.target.classList.contains('droppable') || e.target.dataset.dropzone) {
          e.preventDefault();
          
          const isCorrect = this.checkDragDropAnswer(draggedElement, e.target);
          
          this.trackInteraction('drop', e.target, {
            draggedId: draggedElement?.id,
            dropzoneId: e.target.id,
            isCorrect
          });
          
          if (isCorrect !== undefined) {
            this.provideFeedback(e.target, isCorrect);
          }
        }
      });
      
      document.addEventListener('dragover', (e) => {
        if (e.target.classList.contains('droppable') || e.target.dataset.dropzone) {
          e.preventDefault();
        }
      });
    },
    
    // Check drag and drop answer
    checkDragDropAnswer(dragged, dropzone) {
      if (!dragged || !dropzone) return undefined;
      
      const expectedAnswer = dropzone.dataset.answer || dropzone.dataset.expect;
      const draggedAnswer = dragged.dataset.value || dragged.textContent;
      
      if (expectedAnswer) {
        return expectedAnswer === draggedAnswer;
      }
      
      return undefined;
    },
    
    // Set up math tracking
    setupMathTracking() {
      // Track MathJax/KaTeX inputs
      document.addEventListener('input', (e) => {
        if (e.target.matches('.math-input, [data-math-input], .katex-input')) {
          this.trackInteraction('math-input', e.target, {
            expression: e.target.value
          });
          
          // Try to evaluate if it's a simple expression
          this.evaluateMath(e.target.value, e.target);
        }
      });
    },
    
    // Simple math evaluation
    evaluateMath(expression, element) {
      try {
        // Very basic evaluation - in production, use math.js or similar
        const result = Function('"use strict"; return (' + expression + ')')();
        const expected = element.dataset.answer;
        
        if (expected && result.toString() === expected) {
          this.provideFeedback(element, true);
          this.markActivityComplete(element);
        }
      } catch (e) {
        // Invalid expression, ignore
      }
    },
    
    // Enhance interactive elements with QLA features
    enhanceInteractiveElements() {
      // Enhance multiple choice questions
      document.querySelectorAll('.question, .quiz-question').forEach(q => {
        this.enhanceQuestion(q);
      });
      
      // Enhance interactive diagrams
      document.querySelectorAll('.interactive-diagram, [data-interactive-diagram]').forEach(d => {
        this.enhanceDiagram(d);
      });
      
      // Enhance code editors
      document.querySelectorAll('.code-editor, [data-code-editor]').forEach(e => {
        this.enhanceCodeEditor(e);
      });
      
      // Add progress indicators
      this.addProgressIndicators();
    },
    
    // Enhance question element
    enhanceQuestion(question) {
      const options = question.querySelectorAll('.option, .choice, input[type="radio"]');
      
      options.forEach(option => {
        option.addEventListener('click', (e) => {
          // Remove previous selections
          options.forEach(o => o.classList.remove('selected'));
          option.classList.add('selected');
          
          // Check answer if immediate feedback is enabled
          if (question.dataset.immediateFeedback === 'true') {
            const isCorrect = option.dataset.correct === 'true';
            this.provideFeedback(option, isCorrect);
            
            if (isCorrect) {
              question.dataset.completed = 'true';
              this.checkSlideCompletion();
            }
          }
        });
      });
      
      // Add submit button if not present
      if (!question.querySelector('.submit-answer')) {
        const submitBtn = document.createElement('button');
        submitBtn.className = 'submit-answer qla-btn';
        submitBtn.textContent = 'Submit Answer';
        submitBtn.onclick = () => this.submitQuestion(question);
        question.appendChild(submitBtn);
      }
    },
    
    // Submit question answer
    submitQuestion(question) {
      const selected = question.querySelector('.selected, input:checked');
      if (!selected) {
        alert('Please select an answer');
        return;
      }
      
      const isCorrect = selected.dataset.correct === 'true' || 
                       selected.value === question.dataset.answer;
      
      this.trackInteraction('submit-answer', question, {
        questionId: question.id,
        answer: selected.value || selected.textContent,
        isCorrect
      });
      
      this.provideFeedback(question, isCorrect);
      
      if (isCorrect) {
        question.dataset.completed = 'true';
        this.checkSlideCompletion();
      }
    },
    
    // Add progress indicators
    addProgressIndicators() {
      // Add main progress bar if not exists
      if (!document.querySelector('.qla-progress-bar')) {
        const progressBar = document.createElement('div');
        progressBar.className = 'qla-progress-bar';
        progressBar.innerHTML = `
          <div class="qla-progress-fill" style="width: 0%"></div>
          <div class="qla-progress-text">0% Complete</div>
        `;
        
        progressBar.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: #e5e7eb;
          z-index: 9999;
        `;
        
        document.body.appendChild(progressBar);
      }
      
      // Add slide counter if not exists
      if (!document.querySelector('.qla-slide-counter')) {
        const counter = document.createElement('div');
        counter.className = 'qla-slide-counter';
        counter.innerHTML = `Slide ${this.state.currentSlide} of ${this.state.totalSlides}`;
        
        counter.style.cssText = `
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 8px 16px;
          background: rgba(108, 29, 69, 0.9);
          color: white;
          border-radius: 8px;
          font-weight: 600;
          z-index: 9999;
        `;
        
        document.body.appendChild(counter);
      }
    },
    
    // Update progress bar
    updateProgressBar() {
      const viewedSlides = Object.keys(this.state.slideProgress).length;
      const progress = Math.round((viewedSlides / this.state.totalSlides) * 100);
      
      const progressFill = document.querySelector('.qla-progress-fill');
      const progressText = document.querySelector('.qla-progress-text');
      const slideCounter = document.querySelector('.qla-slide-counter');
      
      if (progressFill) {
        progressFill.style.width = `${progress}%`;
        progressFill.style.background = 'linear-gradient(90deg, #C7A34F, #6C1D45)';
      }
      
      if (progressText) {
        progressText.textContent = `${progress}% Complete`;
      }
      
      if (slideCounter) {
        slideCounter.innerHTML = `Slide ${this.state.currentSlide} of ${this.state.totalSlides}`;
      }
    },
    
    // Start progress tracking
    startProgressTracking() {
      // Send progress updates periodically
      setInterval(() => {
        this.sendProgress();
      }, this.config.progressInterval);
      
      // Track time on each slide
      setInterval(() => {
        if (this.state.slideProgress[this.state.currentSlide]) {
          this.state.slideProgress[this.state.currentSlide].timeSpent += 1;
        }
      }, 1000);
      
      // Track before unload
      window.addEventListener('beforeunload', () => {
        this.sendProgress(true);
      });
    },
    
    // Send interactions to server
    async sendInteractions() {
      if (this.state.pendingInteractions.length === 0) return;
      
      const interactions = [...this.state.pendingInteractions];
      this.state.pendingInteractions = [];
      
      try {
        const response = await fetch(`${this.config.apiEndpoint}/lessons/${this.state.lessonId}/interaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            interactions,
            timestamp: Date.now()
          })
        });
        
        if (response.ok) {
          console.log(`📤 Sent ${interactions.length} interactions`);
        }
      } catch (error) {
        console.error('Failed to send interactions:', error);
        // Re-add to pending
        this.state.pendingInteractions.unshift(...interactions);
      }
    },
    
    // Send progress to server
    async sendProgress(immediate = false) {
      const timeSpent = Math.round((Date.now() - this.state.startTime) / 1000);
      const viewedSlides = Object.keys(this.state.slideProgress).length;
      const progress = Math.round((viewedSlides / this.state.totalSlides) * 100);
      
      const progressData = {
        lesson_id: this.state.lessonId,
        progress,
        time_spent: timeSpent,
        slide_progress: this.state.slideProgress,
        interactions_completed: this.state.interactions.map(i => ({
          type: i.type,
          timestamp: i.timestamp,
          data: i.data
        })),
        completed: progress >= 100
      };
      
      // Send via WebSocket if available for real-time updates
      if (this.state.socket && this.state.socket.connected) {
        this.state.socket.emit('lesson-progress', progressData);
      }
      
      // Also send via HTTP for persistence
      if (immediate || this.shouldSaveProgress()) {
        try {
          const response = await fetch(`${this.config.apiEndpoint}/progress/lesson`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(progressData)
          });
          
          if (response.ok) {
            console.log(`📊 Progress saved: ${progress}%`);
          }
        } catch (error) {
          console.error('Failed to save progress:', error);
        }
      }
    },
    
    // Check if progress should be saved
    shouldSaveProgress() {
      const viewedSlides = Object.keys(this.state.slideProgress).length;
      return viewedSlides > 0 && (
        viewedSlides % 5 === 0 || // Every 5 slides
        this.state.interactions.length % 10 === 0 || // Every 10 interactions
        Date.now() - this.lastSave > 30000 // Every 30 seconds
      );
    },
    
    // Emit progress event to parent
    emitProgress(data) {
      const message = {
        type: 'lesson-progress',
        lessonId: this.state.lessonId,
        ...data,
        timestamp: Date.now()
      };
      
      // Send to parent window
      if (window.parent !== window) {
        window.parent.postMessage(message, '*');
      }
      
      // Emit custom event
      window.dispatchEvent(new CustomEvent('qla-progress', { detail: message }));
      
      // Send via WebSocket if connected
      if (this.state.socket && this.state.socket.connected) {
        this.state.socket.emit('lesson-progress', message);
      }
    },
    
    // Set up message handlers
    setupMessageHandlers() {
      window.addEventListener('message', (event) => {
        if (event.data.type === 'qla-control') {
          this.handleControlMessage(event.data);
        } else if (event.data.type === 'qla-info') {
          this.state.lessonId = event.data.lessonId || this.state.lessonId;
          this.state.userId = event.data.userId || this.state.userId;
        }
      });
    },
    
    // Handle control messages from parent
    handleControlMessage(data) {
      switch(data.action) {
        case 'next-slide':
          this.navigateToSlide(this.state.currentSlide + 1);
          break;
        case 'prev-slide':
          this.navigateToSlide(this.state.currentSlide - 1);
          break;
        case 'go-to-slide':
          this.navigateToSlide(data.slideNumber);
          break;
        case 'reset':
          this.resetLesson();
          break;
        case 'get-progress':
          this.sendProgress(true);
          break;
      }
    },
    
    // Handle teacher control in classroom mode
    handleTeacherControl(data) {
      switch(data.action) {
        case 'next_slide':
          this.navigateToSlide(this.state.currentSlide + 1);
          break;
        case 'prev_slide':
          this.navigateToSlide(this.state.currentSlide - 1);
          break;
        case 'go_to_slide':
          this.navigateToSlide(data.data.slide_number);
          break;
        case 'highlight':
          this.highlightElement(data.data.selector);
          break;
        case 'lock':
          this.lockInteractions();
          break;
        case 'unlock':
          this.unlockInteractions();
          break;
      }
    },
    
    // Navigate to specific slide
    navigateToSlide(slideNumber) {
      if (slideNumber < 1 || slideNumber > this.state.totalSlides) return;
      
      // Hide current slide
      const currentSlide = document.querySelector(`[data-slide-number="${this.state.currentSlide}"]`);
      if (currentSlide) {
        currentSlide.classList.remove('active');
        currentSlide.style.display = 'none';
      }
      
      // Show target slide
      const targetSlide = document.querySelector(`[data-slide-number="${slideNumber}"]`);
      if (targetSlide) {
        targetSlide.classList.add('active');
        targetSlide.style.display = 'block';
        
        // Scroll to view
        targetSlide.scrollIntoView({ behavior: 'smooth' });
        
        // Update state
        this.onSlideView(slideNumber);
      }
      
      // Try navigation buttons if they exist
      if (slideNumber > this.state.currentSlide) {
        document.querySelector('#next, .next-slide, [data-next]')?.click();
      } else {
        document.querySelector('#prev, .prev-slide, [data-prev]')?.click();
      }
    },
    
    // Highlight element for classroom attention
    highlightElement(selector) {
      const element = document.querySelector(selector);
      if (!element) return;
      
      element.classList.add('qla-highlight');
      element.style.cssText += `
        box-shadow: 0 0 20px rgba(199, 163, 79, 0.8);
        border: 2px solid #C7A34F;
        animation: pulse 2s infinite;
      `;
      
      setTimeout(() => {
        element.classList.remove('qla-highlight');
        element.style.boxShadow = '';
        element.style.border = '';
      }, 5000);
    },
    
    // Lock interactions (for teacher control)
    lockInteractions() {
      document.body.style.pointerEvents = 'none';
      document.body.dataset.locked = 'true';
      
      const lockOverlay = document.createElement('div');
      lockOverlay.id = 'qla-lock-overlay';
      lockOverlay.innerHTML = '🔒 Waiting for teacher...';
      lockOverlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 20px 40px;
        background: rgba(108, 29, 69, 0.95);
        color: white;
        border-radius: 12px;
        font-size: 18px;
        font-weight: 600;
        z-index: 10000;
      `;
      
      document.body.appendChild(lockOverlay);
    },
    
    // Unlock interactions
    unlockInteractions() {
      document.body.style.pointerEvents = '';
      document.body.dataset.locked = 'false';
      
      const lockOverlay = document.getElementById('qla-lock-overlay');
      if (lockOverlay) {
        lockOverlay.remove();
      }
    },
    
    // Reset lesson
    resetLesson() {
      this.state.currentSlide = 1;
      this.state.slideProgress = {};
      this.state.interactions = [];
      this.state.pendingInteractions = [];
      this.state.startTime = Date.now();
      
      // Reset UI
      document.querySelectorAll('[data-viewed]').forEach(el => {
        el.dataset.viewed = 'false';
      });
      
      document.querySelectorAll('[data-completed]').forEach(el => {
        el.dataset.completed = 'false';
        el.classList.remove('completed');
      });
      
      document.querySelectorAll('.selected').forEach(el => {
        el.classList.remove('selected');
      });
      
      this.updateProgressBar();
      this.navigateToSlide(1);
    }
  };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => QLA_BRIDGE.init());
  } else {
    QLA_BRIDGE.init();
  }
  
  // Expose to global scope for debugging
  window.QLA_BRIDGE = QLA_BRIDGE;
})();
