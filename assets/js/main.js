(function () {
  const doc = document
  const rootEl = doc.documentElement
  const body = doc.body
  const lightSwitch = doc.getElementById('lights-toggle')
  /* global ScrollReveal */
  const sr = window.sr = ScrollReveal()

  rootEl.classList.remove('no-js')
  rootEl.classList.add('js')

  window.addEventListener('load', function () {
    const loader = document.querySelector('.loader-cover');
    if (loader) {
      loader.style.display = 'none';
    }
    body.classList.add('is-loaded')
  })

  // Reveal animations
  function revealAnimations () {
    sr.reveal('.feature', {
      duration: 600,
      distance: '20px',
      easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
      origin: 'right',
      viewFactor: 0.2
    })
  }

  if (body.classList.contains('has-animations')) {
    window.addEventListener('load', revealAnimations)
  }

  // Light switcher
  if (lightSwitch) {
    const colorSchemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
    let hasManualToggle = false

    const applySystemTheme = function (isDark) {
      lightSwitch.checked = !isDark
      checkLights()
    }

    if (colorSchemeQuery) {
      applySystemTheme(colorSchemeQuery.matches)

      const handleSystemThemeChange = function (e) {
        if (!hasManualToggle) {
          applySystemTheme(e.matches)
        }
      }

      if (colorSchemeQuery.addEventListener) {
        colorSchemeQuery.addEventListener('change', handleSystemThemeChange)
      } else if (colorSchemeQuery.addListener) {
        colorSchemeQuery.addListener(handleSystemThemeChange)
      }
    } else {
      checkLights()
    }

    window.addEventListener('load', checkLights)
    lightSwitch.addEventListener('change', function () {
      hasManualToggle = true
      checkLights()
    })
  }

  // Latest version from version.txt
  const versionEls = doc.querySelectorAll('.app-version')
  if (versionEls.length && window.fetch) {
    window.fetch('./app/version.txt', { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Failed to load version.txt')
        }
        return response.text()
      })
      .then(function (text) {
        const version = text.trim()
        if (!version) {
          return
        }
        const normalizedVersion = version.charAt(0).toLowerCase() === 'v' ? version : 'v' + version
        versionEls.forEach(function (el) {
          const textEl = el.querySelector('.app-version-text')
          if (textEl) {
            textEl.textContent = normalizedVersion
            el.classList.add('is-visible')
          }
        })
      })
      .catch(function () {
        // Keep hidden when version.txt is unavailable
      })
  }

  // Download trigger and thank-you modal
  const downloadModal = doc.getElementById('download-modal')
  const downloadBtns = doc.querySelectorAll('.js-download-btn')
  if (downloadModal && downloadBtns.length) {
    const closeEls = downloadModal.querySelectorAll('.js-modal-close')
    const copyBtn = downloadModal.querySelector('.js-copy-qq')
    let copyTimer = null

    const openDownloadModal = function () {
      downloadModal.classList.add('is-open')
      downloadModal.setAttribute('aria-hidden', 'false')
    }

    const closeDownloadModal = function () {
      downloadModal.classList.remove('is-open')
      downloadModal.setAttribute('aria-hidden', 'true')
    }

    downloadBtns.forEach(function (btn) {
      btn.addEventListener('click', openDownloadModal)
    })

    closeEls.forEach(function (el) {
      el.addEventListener('click', closeDownloadModal)
    })

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && downloadModal.classList.contains('is-open')) {
        closeDownloadModal()
      }
    })

    if (copyBtn) {
      const defaultCopyText = copyBtn.textContent
      const markCopied = function () {
        copyBtn.textContent = '已复制'
        if (copyTimer) {
          window.clearTimeout(copyTimer)
        }
        copyTimer = window.setTimeout(function () {
          copyBtn.textContent = defaultCopyText
        }, 2000)
      }

      copyBtn.addEventListener('click', function () {
        const text = copyBtn.getAttribute('data-copy-text') || ''
        if (!text) {
          return
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(markCopied).catch(function () {
            fallbackCopyText(text, markCopied)
          })
        } else {
          fallbackCopyText(text, markCopied)
        }
      })
    }
  }

  function fallbackCopyText (text, onSuccess) {
    const textarea = doc.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    doc.body.appendChild(textarea)
    textarea.select()
    try {
      if (doc.execCommand('copy') && onSuccess) {
        onSuccess()
      }
    } finally {
      doc.body.removeChild(textarea)
    }
  }

  function checkLights () {
    let labelText = lightSwitch.parentNode.querySelector('.label-text')
    if (lightSwitch.checked) {
      body.classList.remove('lights-off')
      if (labelText) {
        labelText.innerHTML = '深色'
      }
    } else {
      body.classList.add('lights-off')
      if (labelText) {
        labelText.innerHTML = '浅色'
      }
    }
  }
}())
