import React, { useState, useEffect } from 'react';
import './OnboardingTour.css';

const OnboardingTour = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const steps = [
    {
      id: 'welcome',
      title: '欢迎使用萌哩壁纸 🎨',
      content: '发现精美的动漫壁纸，让你的桌面更加个性化！壁纸每日更新，图图有惊喜，天天都心喜~',
      highlight: null,
      position: 'center'
    },
    {
      id: 'navigation',
      title: '切换壁纸 ⬅️➡️',
      content: '使用左右箭头键、鼠标滚轮或点击两侧图片来浏览壁纸',
      highlight: '.carousel-3d-container',
      position: 'center'
    },
    {
      id: 'set-wallpaper',
      title: '设置壁纸 🖼️',
      content: '点击此按钮将当前图片设为桌面壁纸，开启自动壁纸后将自动设置',
      highlight: '.set-wallpaper-button',
      position: 'left'
    },
    {
      id: 'wallpaper-info',
      title: '壁纸信息 ℹ️',
      content: '在页面下方信息栏查看当前壁纸的ID、画师和来源信息',
      highlight: '.wallpaper-info',
      position: 'top'
    },
    {
      id: 'indicators',
      title: '快速跳转 🎯',
      content: '您可以点击底部指示器可以快速跳转到任意壁纸',
      highlight: '.indicator-container',
      position: 'top'
    },
    {
      id: 'moely-link',
      title: '查看原图 🔗',
      content: '点击"在萌哩打开"按钮可以在浏览器中查看高清原图',
      highlight: '.moely-link-button',
      position: 'left'
    },
    {
      id: 'settings',
      title: '设置 ⚙️',
      content: '您可以在设置面板中设定开机自启，支持手动清除本地缓存',
      highlight: '.settings-button',
      position: 'center'
    },
    {
      id: 'author',
      title: '关于我们 👨‍💻',
      content: '本应用由萌哩开发，致力于为二次元爱好者提供优质壁纸体验，项目已在GitHub上开源。',
      highlight: null,
      position: 'center'
    },
    {
      id: 'complete',
      title: '开始探索 🚀',
      content: '现在你已经了解了所有功能，开始享受精美的壁纸吧！（F1键可随时重新观看本指引）',
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
    const tooltipWidth = 350; // 提示框宽度
    const tooltipHeight = 220; // 提示框高度
    const margin = 30; // 边距

    // 尝试多个定位策略
    const positions = ['top', 'bottom', 'left', 'right', 'center'];
    let bestStyle = null;
    let bestScore = -1;

    for (const pos of positions) {
      let style = {};
      
      switch (pos) {
        case 'top':
          style = {
            top: rect.top - margin,
            left: rect.left + rect.width / 2,
            transform: 'translate(-50%, -100%)'
          };
          break;
        case 'bottom':
          style = {
            top: rect.bottom + margin,
            left: rect.left + rect.width / 2,
            transform: 'translate(-50%, 0)'
          };
          break;
        case 'left':
          style = {
            top: rect.top + rect.height / 2,
            left: rect.left - margin,
            transform: 'translate(-100%, -50%)'
          };
          break;
        case 'right':
          style = {
            top: rect.top + rect.height / 2,
            left: rect.right + margin,
            transform: 'translate(0, -50%)'
          };
          break;
        case 'center':
          style = {
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            position: 'fixed'
          };
          break;
      }

      // 计算这个位置的得分（越高的分数越好）
      let score = 0;
      
      // 检查是否在屏幕范围内
      const left = typeof style.left === 'string' ? 
        (style.left === '50%' ? window.innerWidth / 2 : 0) : 
        style.left;
      const top = typeof style.top === 'string' ? 
        (style.top === '50%' ? window.innerHeight / 2 : 0) : 
        style.top;

      if (pos === 'center') {
        score = 100; // 居中位置总是安全的
      } else {
        // 检查边界
        const right = left + tooltipWidth;
        const bottom = top + tooltipHeight;
        
        if (left >= margin && right <= window.innerWidth - margin && 
            top >= margin && bottom <= window.innerHeight - margin) {
          score = 90; // 完全在屏幕内
        } else if (left >= 0 && right <= window.innerWidth && 
                   top >= 0 && bottom <= window.innerHeight) {
          score = 70; // 部分在屏幕内
        } else {
          score = 30; // 超出屏幕
        }
        
        // 优先选择原始位置
        if (pos === position) {
          score += 10;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestStyle = style;
      }
    }

    // 如果最佳位置仍然有问题，使用居中位置
    if (bestScore < 50) {
      bestStyle = {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        position: 'fixed'
      };
    }

    return bestStyle;
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
