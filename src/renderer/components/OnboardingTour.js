import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './OnboardingTour.css';

const TOUR_STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用萌哩壁纸',
    content: '每日精选二次元动漫壁纸，支持本地缓存、壁纸微调与桌面效果实时预览。',
    highlight: null,
    position: 'center'
  },
  {
    id: 'navigation',
    title: '浏览与切换壁纸',
    content: '支持键盘左右方向键、鼠标滚轮、点击两侧预览图或左右箭头按钮切换壁纸。',
    highlight: '.carousel-3d-container',
    position: 'bottom'
  },
  {
    id: 'card-actions',
    title: '编辑与全屏桌面预览',
    content: '悬停当前壁纸右上角可进入编辑器裁剪调色，或打开全屏模拟桌面效果（不会改动真实桌面）。',
    highlight: '.carousel-current .current-card-actions',
    position: 'left'
  },
  {
    id: 'set-wallpaper',
    title: '设为壁纸与自动切换',
    content: '一键应用当前壁纸到桌面，也可开启「自动壁纸」在切换浏览后自动设置。',
    highlight: '.control-buttons',
    position: 'left'
  },
  {
    id: 'bottom-bar',
    title: '壁纸信息与快速跳转',
    content: '底部可查看画师与来源、点击指示器快速跳转，或在浏览器中打开萌哩原图页。',
    highlight: '.indicator-container',
    position: 'top'
  },
  {
    id: 'settings',
    title: '个性化与系统设置',
    content: '支持自定义全局主题色、开机自启动、关闭窗口行为（托盘/退出）及缓存清理。',
    highlight: '.settings-button',
    position: 'left'
  },
  {
    id: 'complete',
    title: '准备就绪',
    content: '现在可以开始挑选壁纸了。使用过程中随时按 F1 键即可重新打开本引导。',
    highlight: null,
    position: 'center'
  }
];

const TOOLTIP_GAP = 18;
const VIEWPORT_PADDING = 16;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeTooltipLayout(targetRect, preferredPosition, tooltipWidth, tooltipHeight) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const order = [preferredPosition, 'bottom', 'top', 'left', 'right'].filter(
    (item, idx, arr) => item && item !== 'center' && arr.indexOf(item) === idx
  );

  const candidates = {
    top: {
      left: targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
      top: targetRect.top - TOOLTIP_GAP - tooltipHeight
    },
    bottom: {
      left: targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
      top: targetRect.bottom + TOOLTIP_GAP
    },
    left: {
      left: targetRect.left - TOOLTIP_GAP - tooltipWidth,
      top: targetRect.top + targetRect.height / 2 - tooltipHeight / 2
    },
    right: {
      left: targetRect.right + TOOLTIP_GAP,
      top: targetRect.top + targetRect.height / 2 - tooltipHeight / 2
    }
  };

  for (const placement of order) {
    const pos = candidates[placement];
    if (!pos) continue;
    const fitsX = pos.left >= VIEWPORT_PADDING && pos.left + tooltipWidth <= vw - VIEWPORT_PADDING;
    const fitsY = pos.top >= VIEWPORT_PADDING && pos.top + tooltipHeight <= vh - VIEWPORT_PADDING;
    if (fitsX && fitsY) {
      return {
        placement,
        style: {
          top: `${Math.round(pos.top)}px`,
          left: `${Math.round(pos.left)}px`
        }
      };
    }
  }

  const fallback = candidates[order[0]] || {
    left: (vw - tooltipWidth) / 2,
    top: (vh - tooltipHeight) / 2
  };
  return {
    placement: 'center',
    style: {
      top: `${Math.round(clamp(fallback.top, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, vh - tooltipHeight - VIEWPORT_PADDING)))}px`,
      left: `${Math.round(clamp(fallback.left, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, vw - tooltipWidth - VIEWPORT_PADDING)))}px`
    }
  };
}

const OnboardingTour = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipLayout, setTooltipLayout] = useState({ placement: 'center', style: {} });
  const tooltipRef = useRef(null);
  const completeTimerRef = useRef(null);

  const currentStepData = TOUR_STEPS[currentStep];

  const completeTour = useCallback(() => {
    setIsVisible(false);
    clearTimeout(completeTimerRef.current);
    completeTimerRef.current = setTimeout(() => {
      localStorage.setItem('moely-wallpaper-tour-completed', 'true');
      onComplete();
    }, 220);
  }, [onComplete]);

  useEffect(() => () => clearTimeout(completeTimerRef.current), []);

  const nextStep = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      completeTour();
    }
  }, [currentStep, completeTour]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  useEffect(() => {
    const handleKeyPress = event => {
      if (!isVisible) return;
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        nextStep();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevStep();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        completeTour();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isVisible, nextStep, prevStep, completeTour]);

  const updatePositions = useCallback(() => {
    const selector = currentStepData.highlight;
    const element = selector ? document.querySelector(selector) : null;
    if (!element) {
      setSpotlightRect(null);
      setTooltipLayout({ placement: 'center', style: {} });
      return;
    }

    const rect = element.getBoundingClientRect();
    const padded = {
      top: rect.top - 6,
      left: rect.left - 6,
      width: rect.width + 12,
      height: rect.height + 12,
      right: rect.right + 6,
      bottom: rect.bottom + 6
    };
    setSpotlightRect(padded);

    if (currentStepData.position === 'center') {
      setTooltipLayout({ placement: 'center', style: {} });
      return;
    }

    const tooltipEl = tooltipRef.current;
    const tooltipWidth = tooltipEl?.offsetWidth || 360;
    const tooltipHeight = tooltipEl?.offsetHeight || 210;
    setTooltipLayout(computeTooltipLayout(padded, currentStepData.position, tooltipWidth, tooltipHeight));
  }, [currentStepData]);

  useLayoutEffect(() => {
    if (!isVisible) return undefined;
    updatePositions();
    window.addEventListener('resize', updatePositions);
    return () => window.removeEventListener('resize', updatePositions);
  }, [isVisible, updatePositions]);

  if (!isVisible) return null;

  const isCenter = !spotlightRect || tooltipLayout.placement === 'center';

  return createPortal(
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="新手引导">
      {spotlightRect ? (
        <div
          className="onboarding-spotlight"
          style={{
            top: `${spotlightRect.top}px`,
            left: `${spotlightRect.left}px`,
            width: `${spotlightRect.width}px`,
            height: `${spotlightRect.height}px`
          }}
        />
      ) : null}
      <div className="onboarding-backdrop" />

      <div
        ref={tooltipRef}
        className={`onboarding-tooltip${isCenter ? ' center' : ''}`}
        style={!isCenter ? tooltipLayout.style : {}}
      >
        <div className="tooltip-header">
          <div className="step-indicator">
            {currentStep + 1} / {TOUR_STEPS.length}
          </div>
          <button type="button" className="skip-button" onClick={completeTour} title="跳过引导" aria-label="跳过引导">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="tooltip-content">
          <h3 className="tooltip-title">{currentStepData.title}</h3>
          <p className="tooltip-description">{currentStepData.content}</p>
        </div>

        <div className="tooltip-actions">
          <button
            type="button"
            className="tour-button secondary"
            onClick={prevStep}
            disabled={currentStep === 0}
          >
            上一步
          </button>

          <div className="progress-dots">
            {TOUR_STEPS.map((step, index) => (
              <button
                key={step.id}
                type="button"
                className={`dot${index === currentStep ? ' active' : ''}${index < currentStep ? ' completed' : ''}`}
                aria-label={`第 ${index + 1} 步：${step.title}`}
                onClick={() => setCurrentStep(index)}
              />
            ))}
          </div>

          <button
            type="button"
            className="tour-button primary"
            onClick={nextStep}
          >
            {currentStep === TOUR_STEPS.length - 1 ? '开始使用' : '下一步'}
          </button>
        </div>

        {!isCenter && (
          <div className={`tooltip-arrow ${tooltipLayout.placement}`} />
        )}
      </div>

      <div className="keyboard-hints">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2" y="6" width="20" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M6 10H8M11 10H13M16 10H18M7 14H17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>方向键 / Enter 切换步骤，ESC 跳过</span>
      </div>
    </div>,
    document.body
  );
};

export default OnboardingTour;
