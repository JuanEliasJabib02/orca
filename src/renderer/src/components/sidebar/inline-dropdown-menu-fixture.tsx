// Test-only stand-in for `@/components/ui/dropdown-menu`: Radix menus need real pointer events to
// open, so this renders their content inline and keeps the handlers a portal would still bubble.
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'

type WithChildren = { children?: ReactNode }

const RadioGroupValue = createContext<string | undefined>(undefined)

function Passthrough({ children }: WithChildren): React.JSX.Element {
  return <>{children}</>
}

type MenuContentProps = WithChildren &
  Pick<
    ComponentProps<'div'>,
    'onClick' | 'onKeyDown' | 'onMouseDown' | 'onMouseUp' | 'onPointerDown' | 'onPointerUp'
  > & { align?: string; side?: string; sideOffset?: number; className?: string }

function MenuContent({
  children,
  onClick,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onPointerDown,
  onPointerUp
}: MenuContentProps): React.JSX.Element {
  return (
    <div
      data-menu-content=""
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {children}
    </div>
  )
}

function SubTrigger({
  children,
  disabled
}: WithChildren & { disabled?: boolean }): React.JSX.Element {
  return (
    <div data-sub-trigger="" data-disabled={disabled ? '' : undefined}>
      {children}
    </div>
  )
}

function Item({
  children,
  disabled,
  variant,
  onSelect
}: WithChildren & {
  disabled?: boolean
  variant?: string
  onSelect?: (event: Event) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-menu-item=""
      data-variant={variant}
      disabled={disabled}
      onClick={() => onSelect?.(new Event('select'))}
    >
      {children}
    </button>
  )
}

function RadioGroup({ children, value }: WithChildren & { value?: string }): React.JSX.Element {
  return (
    <RadioGroupValue.Provider value={value}>
      <div role="group">{children}</div>
    </RadioGroupValue.Provider>
  )
}

function RadioItem({
  children,
  value,
  onSelect
}: WithChildren & { value: string; onSelect?: (event: Event) => void }): React.JSX.Element {
  const checked = useContext(RadioGroupValue) === value
  return (
    <button
      type="button"
      role="menuitemradio"
      data-menu-radio=""
      data-value={value}
      aria-checked={checked}
      onClick={() => onSelect?.(new Event('select'))}
    >
      {children}
    </button>
  )
}

export const inlineDropdownMenu = {
  DropdownMenu: Passthrough,
  DropdownMenuTrigger: Passthrough,
  DropdownMenuContent: MenuContent,
  DropdownMenuSub: Passthrough,
  DropdownMenuSubTrigger: SubTrigger,
  DropdownMenuSubContent: Passthrough,
  DropdownMenuRadioGroup: RadioGroup,
  DropdownMenuRadioItem: RadioItem,
  DropdownMenuItem: Item,
  DropdownMenuSeparator: () => null
}
