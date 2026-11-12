"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native scrolling with an idle scrollbar and fades only where more content exists. */
export function ScrollArea({ className, children, label }: { className: string; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);
  const [visible, setVisible] = useState(false);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    let hideTimer: ReturnType<typeof setTimeout>;
    let hovering = false;
    let focused = element.contains(document.activeElement);
    let pressing = false;
    const reveal = () => { clearTimeout(hideTimer); setVisible(true); };
    const hideWhenIdle = () => {
      clearTimeout(hideTimer);
      if (!hovering && !focused && !pressing) hideTimer = setTimeout(() => setVisible(false), 800);
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovering = true;
      reveal();
    };
    const leave = () => { hovering = false; hideWhenIdle(); };
    const down = () => {
      pressing = true;
      reveal();
    };
    const release = () => {
      if (!pressing) return;
      pressing = false;
      hideWhenIdle();
    };
    const focus = () => { focused = true; reveal(); };
    const blur = (event: FocusEvent) => {
      focused = event.relatedTarget instanceof Node && element.contains(event.relatedTarget);
      if (!focused) hideWhenIdle();
    };
    const update = () => {
      const top = element.scrollTop > 1;
      const bottom = element.scrollHeight - element.clientHeight - element.scrollTop > 1;
      setEdges((current) => current.top === top && current.bottom === bottom ? current : { top, bottom });
    };
    const onScroll = () => {
      update();
      setScrolling(true);
      reveal();
      hideWhenIdle();
      clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), 800);
    };
    const resize = new ResizeObserver(update);
    const observeSizes = () => {
      resize.disconnect();
      resize.observe(element);
      Array.from(element.children).forEach((child) => resize.observe(child));
      update();
    };
    const mutation = new MutationObserver(observeSizes);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    observeSizes();
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("pointerdown", down, { passive: true });
    element.addEventListener("focusin", focus);
    element.addEventListener("focusout", blur);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    if (focused) reveal();
    return () => {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      resize.disconnect();
      mutation.disconnect();
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("focusin", focus);
      element.removeEventListener("focusout", blur);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  return <div ref={ref} className={`${className} scroll-area`} tabIndex={0} role="region" aria-label={label}
    data-scrollbar-visible={visible} data-scrolling={scrolling} data-fade-top={edges.top} data-fade-bottom={edges.bottom}>{children}</div>;
}
