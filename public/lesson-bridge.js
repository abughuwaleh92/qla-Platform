
/**
 * QLA Lesson Bridge
 * Injected by parent app into lesson iframes to normalize progress events.
 * It emits window.parent.postMessage({type:'lesson-progress', slide, total, complete }, '*')
 * When a practice button with data-complete or .mark-complete is clicked,
 * it sends a 'complete:true' event.
 */
(function(){
  try {
    const doc = window.document;
    const slides = doc.querySelectorAll('#slides > section, .slide, section[data-slide]');
    const total = slides.length || 1;
    let current = 1;

    function emit(extra){
      const payload = Object.assign({ type: 'lesson-progress', slide: current, total }, extra||{});
      window.parent && window.parent.postMessage(payload, '*');
    }
    function syncIndex() {
      // try to infer current slide index from active/visible slides
      const active = doc.querySelector('#slides > section.active, .slide.active, section[data-active="true"]');
      if (active) {
        current = Array.from(slides).indexOf(active) + 1 || current;
      }
      emit();
    }
    // Observe changes to classes to detect slide navigation
    const observer = new MutationObserver(syncIndex);
    observer.observe(doc.body, { attributes:true, subtree:true, attributeFilter:['class','data-active','style'] });
    setInterval(syncIndex, 2000);

    // Hook common controls
    ['#next','#prev','#controls button'].forEach(sel=>{
      doc.querySelectorAll(sel).forEach(btn=>{
        btn.addEventListener('click', ()=> {
          setTimeout(syncIndex, 250);
        });
      })
    });

    // Mark complete when elements with data-complete or .mark-complete are clicked
    doc.body.addEventListener('click', (e)=>{
      const el = e.target.closest('[data-complete], .mark-complete, button.finish, button.complete');
      if (el) {
        emit({ complete: true });
      }
    });

    // Also mark complete when any element toggles a class 'correct' on itself or siblings
    const answerObserver = new MutationObserver((muts)=>{
      for (const m of muts) {
        if (m.type==='attributes' && m.target && (m.target.classList?.contains('correct') || m.target.dataset.correct==='true')) {
          emit({ maybeCorrect: true });
        }
      }
    });
    answerObserver.observe(doc.body, { attributes:true, subtree:true });

    // initial event
    emit();
  } catch (err) {
    console.error('[LessonBridge] failed:', err);
  }
})();
