// Verify page script loader - ensures proper load order
(function() {
  // console.log('[VerifyLoader] Starting...');

  const scripts = [
    '/js/config.js',
    '/js/verify.js'
  ];

  let loadedCount = 0;

  function onAllLoaded() {
    // console.log('[VerifyLoader] All scripts loaded, initializing...');
    // Small delay for DOM readiness, then init
    requestAnimationFrame(function() {
      if (typeof window.initVerify === 'function') {
        window.initVerify();
      } else {
        // console.error('[VerifyLoader] initVerify not found after loading');
      }
    });
  }

  function loadScript(src, callback) {
    // Check if already loaded (by checking for script tag OR global functions)
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      // console.log('[VerifyLoader] Already exists:', src);
      callback();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.onload = function() {
      // console.log('[VerifyLoader] Loaded:', src);
      callback();
    };
    script.onerror = function() {
      // console.error('[VerifyLoader] Failed:', src);
      callback(); // Continue anyway
    };
    document.head.appendChild(script);
  }

  function loadAllScripts() {
    // Load config.js first, then verify.js
    loadScript(scripts[0], function() {
      loadScript(scripts[1], function() {
        onAllLoaded();
      });
    });
  }

  // Wait for ethers to be available (with timeout)
  let ethersAttempts = 0;
  const maxEthersAttempts = 100; // 10 seconds max

  function waitForEthers() {
    ethersAttempts++;
    if (typeof ethers !== 'undefined') {
      // console.log('[VerifyLoader] ethers ready after', ethersAttempts * 100, 'ms');
      loadAllScripts();
    } else if (ethersAttempts < maxEthersAttempts) {
      setTimeout(waitForEthers, 100);
    } else {
      // console.error('[VerifyLoader] ethers not available after 10s, loading anyway...');
      loadAllScripts();
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForEthers);
  } else {
    waitForEthers();
  }
})();
