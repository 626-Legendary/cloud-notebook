"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverContent = function PopoverContent({
  className = "", sideOffset = 6, ...props
}: PopoverPrimitive.PopoverContentProps) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content sideOffset={sideOffset} className={`popover-content ${className}`.trim()} {...props} />
  </PopoverPrimitive.Portal>;
};
