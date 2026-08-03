/* eslint-disable */
class TributeEvents {
  constructor(tribute) {
    this.tribute = tribute;
    this.tribute.events = this;
  }

  static keys() {
    return [
      {
        key: 9,
        value: "TAB"
      },
      {
        key: 8,
        value: "DELETE"
      },
      {
        key: 13,
        value: "ENTER",
        condition: (e) => {
          if (e.shiftKey) {
            return 'SHIFT_ENTER';
          } else if (e.ctrlKey || e.metaKey) {
            return 'CTRL_ENTER';
          }
        }
      },
      {
        key: 27,
        value: "ESCAPE"
      },
      {
        key: 32,
        value: "SPACE"
      },
      {
        key: 38,
        value: "UP"
      },
      {
        key: 40,
        value: "DOWN"
      },
      {
        key: [20, 16, 17, 91, 18, 34, 33, 45, 46],
        value: "empty"
      }
    ];
  }

  bind(element) {
    element.boundKeydown = this.keydown.bind(element, this);
    element.boundKeyup = this.keyup.bind(element, this);
    element.boundInput = this.input.bind(element, this);
    // element.boundPaste = this.paste.bind(element, this);
    element.boundCompositionStart = this.compositionstart.bind(element, this);
    element.boundCompositionEnd = this.compositionend.bind(element, this);
    element.boundFocus = this.inputFocus.bind(element, this);

    element.addEventListener("keydown", element.boundKeydown, true);
    element.addEventListener("keyup", element.boundKeyup, true);
    element.addEventListener("input", element.boundInput, true);
    // element.addEventListener("paste", element.boundPaste, true);
    element.addEventListener("compositionstart", element.boundCompositionStart, true);
    element.addEventListener("compositionend", element.boundCompositionEnd, true);
    element.addEventListener("focus", element.boundFocus, true);
  }

  unbind(element) {
    element.removeEventListener("keydown", element.boundKeydown, true);
    element.removeEventListener("keyup", element.boundKeyup, true);
    element.removeEventListener("input", element.boundInput, true);
    // element.removeEventListener("paste", element.boundPaste, true);
    element.removeEventListener("compositionstart", element.boundCompositionStart, true);
    element.removeEventListener("compositionend", element.boundCompositionEnd, true);
    element.removeEventListener("focus", element.boundFocus, true);

    delete element.boundKeydown;
    delete element.boundKeyup;
    delete element.boundInput;
    delete element.boundPaste;
    delete element.boundCompositionStart;
    delete element.boundCompositionEnd;
    delete element.boundFocus;
  }

  paste(instance, event) {
    event.preventDefault();
    let text = '';
    if(window.clipboardData && clipboardData.setData) {
      // IE
        text = window.clipboardData.getData('text') || '';
    } else {
        text = (event.originalEvent || event).clipboardData.getData('text/html') || '';
    }
    instance.tribute.insertTextAtCursor(text);
  }

  compositionstart(instance, event) {
    instance.inputIsComposing = true;
  }
  compositionend(instance, event) {
    instance.inputIsComposing = false;
    instance.keyup.call(this, instance, event);
  }

  keydown(instance, event) {
    // 判断是否是关闭选项框按钮
    if (instance.shouldDeactivate(event)) {
      instance.tribute.isActive = false;
      instance.tribute.hideMenu();
    }

    let element = this;
    instance.commandEvent = false;

    TributeEvents.keys().forEach(o => {
      if (Array.isArray(o.key) ? o.key.includes(event.keyCode) : o.key === event.keyCode) {
        instance.commandEvent = true;
        let eventName = o.value;
        if(typeof o.condition === 'function'){
          eventName = o.condition(event) || o.value;
        }
        instance.callbacks()[eventName.toLowerCase()](event, element);
      }
    });
  }

  input(instance, event) {
    instance.inputEvent = true;
    instance.keyup.call(this, instance, event);
  }

  inputFocus(instance, event) {
    if (instance.tribute && instance.tribute.triggerType === 'focus') {
        instance.updateSelection(this);
        instance.inputEvent = true;
        let tribute = instance.tribute;
        tribute.current.trigger = '';

        let collectionItem = tribute.collection.find(item => {
          return item.trigger === '';
        });
        tribute.current.collection = collectionItem;
        tribute.showMenuFor(event.target, true);
    }
  }

  // 点击其他区域关闭
  click(instance, event) {
      let toggleEl = null;
      try {
          if (instance.tribute.triggerType === 'focus') {
              const parentEl = event.target.parentElement;
              if (parentEl.nodeName === 'svg') {
                  toggleEl = parentEl.parentElement
              } else if (parentEl && parentEl.className && parentEl.className.indexOf('toggle-icon') > -1) {
                  toggleEl = parentEl;
              } else if (event.target.className.includes('toggle-icon')) {
                  toggleEl = event.target;
              }
          }
      } catch (e) {}
      if (toggleEl) {
          return;
      }
      let tribute = instance.tribute;
      if (tribute.menu && tribute.menu.contains(event.target)) {
      let li = event.target;
      event.preventDefault();
      event.stopPropagation();
      while (li.nodeName.toLowerCase() !== "li") {
        li = li.parentNode;
        if (!li || li === tribute.menu) {
          // throw new Error("cannot find the <li> container for the click");
        }
      }
      tribute.selectItemAtIndex(li.getAttribute("data-index"), event);
      tribute.hideMenu();

      // TODO: should fire with externalTrigger and target is outside of menu
    } else if (tribute.current.element && !tribute.current.externalTrigger) {
      tribute.current.externalTrigger = false;
      setTimeout(() => tribute.hideMenu());
    }
  }

  keyup(instance, event) {
    // 中文输入
    if (instance.inputIsComposing === true) {
      // return;
    }
    if (instance.inputEvent) {
      instance.inputEvent = false;
    }
    const isFocus = instance.tribute && instance.tribute.triggerType === 'focus';
    instance.updateSelection(this);

    if (!event.keyCode || event.keyCode === 27) return;

    if (!instance.tribute.allowSpaces && instance.tribute.hasTrailingSpace) {
      instance.tribute.hasTrailingSpace = false;
      instance.commandEvent = true;
      instance.callbacks()["space"](event, this);
      return;
    }

    if (!instance.tribute.isActive) {
      if (instance.tribute.autocompleteMode) {
        instance.callbacks().triggerChar(event, this, "");
      } else {
        let keyCode = instance.getKeyCode(instance, this, event);
        if (isFocus) {
          instance.callbacks().triggerChar(event, this, '');
          return;
        } else {
          if (isNaN(keyCode) || !keyCode) return;
        }
        let trigger = instance.tribute.triggers().find(trigger => {
          return trigger.charCodeAt(0) === keyCode;
        });

        if (typeof trigger !== "undefined") {
          instance.callbacks().triggerChar(event, this, trigger);
        }
      }
    }

    if (
      instance.tribute.current.mentionText.length <
      instance.tribute.current.collection.menuShowMinLength
    ) {
      return;
    }

    if (
      (((instance.tribute.current.trigger || instance.tribute.autocompleteMode) && instance.commandEvent === false) ||
      (instance.tribute.isActive && event.keyCode === 8)) && instance.tribute.current.collection.displayJudgment() || isFocus
    ) {
      instance.tribute.showMenuFor(this, true);
    }
  }

  shouldDeactivate(event) {
    if (!this.tribute.isActive) return false;

    if (this.tribute.current.mentionText.length === 0) {
      let eventKeyPressed = false;
      TributeEvents.keys().forEach(o => {
        if (Array.isArray(o.key) ? o.key.includes(event.keyCode) : event.keyCode === o.key) eventKeyPressed = true;
      });

      return !eventKeyPressed;
    }

    return false;
  }

  getKeyCode(instance, el, event) {
    let char;
    let tribute = instance.tribute;
    let info = tribute.range.getTriggerInfo(
      false,
      tribute.hasTrailingSpace,
      true,
      tribute.allowSpaces,
      tribute.autocompleteMode
    );

    if (info) {
      return info.mentionTriggerChar.charCodeAt(0);
    } else {
      return false;
    }
  }

  // 更新替换区域
  updateSelection(el) {
    this.tribute.current.element = el;
    let info = this.tribute.range.getTriggerInfo(
      false,
      this.tribute.hasTrailingSpace,
      true,
      this.tribute.allowSpaces,
      this.tribute.autocompleteMode
    );

    if (info) {
      this.tribute.current.selectedPath = info.mentionSelectedPath;
      this.tribute.current.mentionText = info.mentionText;
      this.tribute.current.selectedOffset = info.mentionSelectedOffset;
    }
  }

  callbacks() {
    return {
      triggerChar: (e, el, trigger) => {
        let tribute = this.tribute;
        tribute.current.trigger = trigger;

        let collectionItem = tribute.collection.find(item => {
            if (!item.displayJudgment) {
                item.displayJudgment = () => true;
            }
            if (!item.searchDisable) {
                item.searchDisable = () => false;
            }
            return item.trigger === trigger;
        });
        tribute.current.collection = collectionItem;
        if (collectionItem.triggerType === 'focus') {
          tribute.showMenuFor(el, true);
          return;
        }
        if (
          tribute.current.mentionText.length >= tribute.current.collection.menuShowMinLength &&
          tribute.inputEvent &&
          tribute.current.collection.displayJudgment()
        ) {
          tribute.showMenuFor(el, true);
        } else if (
          tribute.current.mentionText.length === 0 &&
          tribute.current.collection.displayJudgment()
        ) {
          tribute.showMenuFor(el, true);
        }
      },
      enter: (e, el) => {
        // choose selection
        if (this.tribute.isActive && this.tribute.current.filteredItems) {
          e.preventDefault();
          e.stopPropagation();
          setTimeout(() => {
            this.tribute.selectItemAtIndex(this.tribute.menuSelected, e);
            this.tribute.hideMenu();
          }, 0);
        } else {
          e.preventDefault();
          e.stopPropagation();
          let enterEvent = new CustomEvent("tribute-enter", {
              detail: ''
          });
          el.dispatchEvent(enterEvent);
        }
      },
      shift_enter: (e, el) => {
        e.preventDefault();
        e.stopPropagation();
        let enterEvent = new CustomEvent("shift-enter", {
              detail: ''
        });
        el.dispatchEvent(enterEvent);
      },
      ctrl_enter: (e, el) => {
        e.preventDefault();
        e.stopPropagation();
        let enterEvent = new CustomEvent("ctrl-enter", {
              detail: ''
        });
        el.dispatchEvent(enterEvent);
      },
      escape: (e, el) => {
        if (this.tribute.isActive) {
          e.preventDefault();
          e.stopPropagation();
          this.tribute.isActive = false;
          this.tribute.hideMenu();
        }
      },
      tab: (e, el) => {
        // choose first match（菜单未展开时不接管 Tab，避免误触发 tribute-enter）
        if (!this.tribute.isActive) return;
        this.callbacks().enter(e, el);
      },
      empty: () => {
        // 空操作
      },
      space: (e, el) => {
        if (this.inputIsComposing) {
            return;
        }
        if (this.tribute.isActive) {
          if (this.tribute.spaceSelectsMatch) {
            this.callbacks().enter(e, el);
          } else if (!this.tribute.allowSpaces) {
            e.stopPropagation();
            setTimeout(() => {
              this.tribute.hideMenu();
              this.tribute.isActive = false;
            }, 0);
          } else {
            if (this.tribute.current.mentionText.length === 0) {
              setTimeout(() => {
                this.tribute.hideMenu();
                this.tribute.isActive = false;
              }, 0);
            }
          }
        }
      },
      up: (e, el) => {
        // navigate up ul
        if (this.tribute.isActive && this.tribute.current.filteredItems) {
          e.preventDefault();
          e.stopPropagation();
          let count = this.tribute.current.filteredItems.length,
            selected = this.tribute.menuSelected;

          if (count > selected && selected > 0) {
            this.tribute.menuSelected--;
            this.setActiveLi();
          } else if (selected === 0) {
            // 关闭键盘上下按键循环
            // this.tribute.menuSelected = count - 1;
            // this.setActiveLi();
            // this.tribute.menu.scrollTop = this.tribute.menu.scrollHeight;
          }
        }
      },
      down: (e, el) => {
        // navigate down ul
        if (this.tribute.isActive && this.tribute.current.filteredItems) {
          e.preventDefault();
          e.stopPropagation();
          let count = this.tribute.current.filteredItems.length - 1,
            selected = this.tribute.menuSelected;

          if (count > selected) {
            this.tribute.menuSelected++;
            this.setActiveLi();
          } else if (count === selected) {
            // 关闭键盘上下按键循环
            // this.tribute.menuSelected = 0;
            // this.setActiveLi();
            // this.tribute.menu.scrollTop = 0;
          }
        }
      },
      delete: (e, el) => {
        if (
          this.tribute.isActive &&
          this.tribute.current.mentionText.length < 1
        ) {
          this.tribute.hideMenu();
        } else if (this.tribute.isActive) {
          this.tribute.showMenuFor(el);
        }
      }
    };
  }

  setActiveLi(index) {
    let lis = this.tribute.menu.querySelectorAll("li"),
      length = lis.length >>> 0;

    if (index) this.tribute.menuSelected = parseInt(index);

    for (let i = 0; i < length; i++) {
      let li = lis[i];
      if (i === this.tribute.menuSelected) {
        li.classList.add(this.tribute.current.collection.selectClass);

        let liClientRect = li.getBoundingClientRect();
        let menuClientRect = this.tribute.menu.firstElementChild.getBoundingClientRect();

        if (liClientRect.bottom > menuClientRect.bottom) {
          let scrollDistance = liClientRect.bottom - menuClientRect.bottom;
          this.tribute.menu.firstElementChild.scrollTop += scrollDistance;
        } else if (liClientRect.top < menuClientRect.top) {
          let scrollDistance = menuClientRect.top - liClientRect.top;
          this.tribute.menu.firstElementChild.scrollTop -= scrollDistance;
        }
      } else {
        li.classList.remove(this.tribute.current.collection.selectClass);
      }
    }
  }

  getFullHeight(elem, includeMargin) {
    let height = elem.getBoundingClientRect().height;

    if (includeMargin) {
      let style = elem.currentStyle || window.getComputedStyle(elem);
      return (
        height + parseFloat(style.marginTop) + parseFloat(style.marginBottom)
      );
    }

    return height;
  }
}

export default TributeEvents;
