import React, { useState, useEffect } from 'react';
import './OnboardingTour.css';

const OnboardingTour = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const steps = [
    {
      id: 'welcome',
      title: '欢迎使用萌哩壁纸 🎨',
      content: '发现精美的动漫壁纸，让你的桌面更加个性化！',
      highlight: null,
      position: 'center'
    },
    {
      id: 'navigation',
      title: '切换壁纸 ⬅️➡️',
      content: '使用左右箭头键、鼠标滚轮或点击两侧图片来浏览壁纸',
      highlight: '.carousel-3d-container',
      position: 'bottom'
    },
    {
      id: 'wallpaper-info',
      title: '壁纸信息 ℹ️',
      content: '在这里查看当前壁纸的ID、画师和来源信息',
      highlight: '.wallpaper-info',
      position: 'top'
    },
    {
      id: 'indicators',
      title: '快速跳转 🎯',
      content: '点击底部指示器可以快速跳转到任意壁纸',
      highlight: '.indicator-container',
      position: 'top'
    },
    {
      id: 'moely-link',
      title: '查看原图 🔗',
      content: '点击"在萌哩打开"按钮可以在浏览器中查看高清原图',
      highlight: '.moely-link-button',
      position: 'top'
    },
    {
      id: 'cache-manager',
      title: '缓存管理 💾',
      content: '点击右上角按钮管理本地缓存，清理空间或重新下载',
      highlight: '.cache-manager-toggle',
      position: 'left'
    },
    {
      id: 'author',
      title: '关于作者 👨‍💻',
      content: '本应用由 ACore 开发，致力于为二次元爱好者提供优质壁纸体验',
      highlight: null,
      position: 'center'
    },
    {
      id: 'complete',
      title: '开始探索 🚀',
      content: '现在你已经了解了所有功能，开始享受精美的壁纸吧！',
      highlight: null,
      position: 'center'
    }
  ];

  const currentStepData = steps[currentStep];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      completeTour();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const skipTour = () => {
    completeTour();
  };

  const completeTour = () => {
    setIsVisible(false);
    setTimeout(() => {
      localStorage.setItem('moely-wallpaper-tour-completed', 'true');
      onComplete();
    }, 300);
  };

  // 键盘事件处理
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!isVisible) return;
      
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        nextStep();
      } else if (e.key === 'ArrowLeft') {
        prevStep();
      } else if (e.key === 'Escape') {
        skipTour();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentStep, isVisible]);

  // 高亮元素
  useEffect(() => {
    if (currentStepData.highlight) {
      const element = document.querySelector(currentStepData.highlight);
      if (element) {
        element.classList.add('tour-highlight');
        return () => element.classList.remove('tour-highlight');
      }
    }
  }, [currentStep]);

  if (!isVisible) return null;

  const getTooltipStyle = () => {
    const highlight = currentStepData.highlight;
    if (!highlight) return {};

    const element = document.querySelector(highlight);
    if (!element) return {};

    const rect = element.getBoundingClientRect();
    const position = currentStepData.position;

    switch (position) {
      case 'top':
        return {
          top: rect.top - 20,
          left: rect.left + rect.width / 2,
          transform: 'translate(-50%, -100%)'
        };
      case 'bottom':
        return {
          top: rect.bottom + 20,
          left: rect.left + rect.width / 2,
          transform: 'translate(-50%, 0)'
        };
      case 'left':
        return {
          top: rect.top + rect.height / 2,
          left: rect.left - 20,
          transform: 'translate(-100%, -50%)'
        };
      case 'right':
        return {
          top: rect.top + rect.height / 2,
          left: rect.right + 20,
          transform: 'translate(0, -50%)'
        };
      default:
        return {};
    }
  };

  // 获取高亮元素的位置和尺寸，用于创建镐空效果
  const getHighlightRect = () => {
    const highlight = currentStepData.highlight;
    if (!highlight) return null;

    const element = document.querySelector(highlight);
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    return {
      top: rect.top - 8,
      left: rect.left - 8,
      width: rect.width + 16,
      height: rect.height + 16
    };
  };

  const isCenter = currentStepData.position === 'center' || !currentStepData.highlight;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-backdrop" onClick={skipTour}></div>
      
      <div 
        className={`onboarding-tooltip ${isCenter ? 'center' : ''}`}
        style={!isCenter ? getTooltipStyle() : {}}
      >
        <div className="tooltip-header">
          <div className="step-indicator">
            {currentStep + 1} / {steps.length}
          </div>
          <button className="skip-button" onClick={skipTour} title="跳过引导">
            ×
          </button>
        </div>

        <div className="tooltip-content">
          <h3 className="tooltip-title">{currentStepData.title}</h3>
          <p className="tooltip-description">{currentStepData.content}</p>
        </div>

        <div className="tooltip-actions">
          <button 
            className="tour-button secondary" 
            onClick={prevStep}
            disabled={currentStep === 0}
          >
            上一步
          </button>
          
          <div className="progress-dots">
            {steps.map((_, index) => (
              <span 
                key={index}
                className={`dot ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
                onClick={() => setCurrentStep(index)}
              />
            ))}
          </div>

          <button 
            className="tour-button primary" 
            onClick={nextStep}
          >
            {currentStep === steps.length - 1 ? '开始使用' : '下一步'}
          </button>
        </div>

        {!isCenter && (
          <div className={`tooltip-arrow ${currentStepData.position}`}></div>
        )}
      </div>

      <div className="keyboard-hints">
        <span>💡 使用方向键导航，ESC跳过</span>
      </div>
    </div>
  );
};

export default OnboardingTour;
