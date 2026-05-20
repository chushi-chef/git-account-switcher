import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,border-color,background-color,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "border border-primary/20 bg-primary/5 text-primary shadow-none hover:border-primary/30 hover:bg-primary/8",
        secondary:
          "border border-border/80 bg-card/55 text-foreground shadow-none hover:bg-card/80 hover:text-primary",
        ghost: "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
        destructive:
          "border border-destructive/20 bg-destructive/5 text-destructive shadow-none hover:border-destructive/30 hover:bg-destructive/8",
        icon: "border border-border/80 bg-card/55 text-primary shadow-none hover:bg-card/80 hover:text-primary",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-xs",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
