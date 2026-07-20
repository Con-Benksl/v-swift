import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * 裸 `<input>` 统一 class（供 Field 内部与页面侧自定义控件复用）。
 * 用法：`<input className={inputClass} />`；校验失败时追加 `inputErrorClass`。
 */
export const inputClass =
  'block w-full rounded-control border border-surface-border bg-surface-card px-3 py-2 text-sm text-surface-800 shadow-card placeholder:text-surface-500 transition-colors duration-150 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-surface-100 disabled:text-surface-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 dark:placeholder:text-surface-400 dark:focus:border-brand-400 dark:focus:ring-brand-400/30 dark:disabled:bg-surface-900 dark:disabled:text-surface-400';

/** 裸 `<select>` 统一 class（与 input 视觉一致） */
export const selectClass = inputClass;

/** 裸 `<textarea>` 统一 class（与 input 视觉一致，最小高度由页面自定） */
export const textareaClass = `${inputClass} min-h-[5rem] resize-y`;

/** 控件错误态描边 class（替换默认描边与焦点色为 danger） */
export const inputErrorClass =
  'border-danger-400 focus:border-danger-500 focus:ring-danger-500/30 dark:border-danger-500 dark:focus:border-danger-400 dark:focus:ring-danger-400/30';

export interface FieldProps {
  /** 字段标签文本 */
  label: ReactNode;
  /**
   * 控件插槽。推荐直接放裸 `<input className={inputClass}>` 等；
   * Field 会在 error 状态下自动把描边改为 danger（通过包裹层 class 联动，无需控件配合）。
   */
  children: ReactNode;
  /** 控件下方的辅助说明（error 存在时被 error 取代，二者不同时显示） */
  hint?: string;
  /** 校验错误信息。存在时：控件描边变 danger + 字段下方红字 + aria-invalid 联动 */
  error?: string;
  /** 是否在标签后显示「必填」星号标记，默认 false */
  required?: boolean;
  /** 覆盖自动生成的 label-htmlFor / 控件 id（控件需要自定义 id 时使用） */
  htmlFor?: string;
  /** 附加 className */
  className?: string;
}

interface NativeControlAccessibilityProps {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
  'aria-required'?: boolean | 'false' | 'true';
}

function isDirectNativeControl(
  child: ReactNode,
): child is ReactElement<NativeControlAccessibilityProps> {
  return (
    isValidElement<NativeControlAccessibilityProps>(child) &&
    typeof child.type === 'string' &&
    (child.type === 'input' || child.type === 'select' || child.type === 'textarea')
  );
}

/**
 * 表单字段容器：label + 控件插槽 + hint/error。
 * error 时通过 CSS 选择器自动给内部控件加 danger 描边，并在下方显示红字。
 * 用法：
 * ```tsx
 * <Field label="服务器地址" hint="支持域名或 IPv4/IPv6" error={errors.host} required>
 *   <input className={inputClass} value={host} onChange={...} />
 * </Field>
 * ```
 */
export function Field({ label, children, hint, error, required = false, htmlFor, className = '' }: FieldProps) {
  const autoId = useId();
  const childList = Children.toArray(children);
  const controlIndex = childList.findIndex(isDirectNativeControl);
  const directControl =
    controlIndex >= 0 && isDirectNativeControl(childList[controlIndex])
      ? childList[controlIndex]
      : null;
  const controlId = htmlFor ?? directControl?.props.id ?? `field-${autoId}`;
  const messageId = `${controlId}-message`;
  const hasError = Boolean(error);
  const hasMessage = hasError || Boolean(hint);
  const enhancedChildren = childList.map((child, index) => {
    if (index !== controlIndex || !isDirectNativeControl(child)) {
      return child;
    }

    const describedBy = [
      child.props['aria-describedby'],
      hasMessage ? messageId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return cloneElement(child, {
      id: controlId,
      required: required || child.props.required,
      'aria-required': required ? true : child.props['aria-required'],
      'aria-invalid': hasError ? true : child.props['aria-invalid'],
      'aria-describedby': describedBy,
    });
  });

  return (
    <div className={className}>
      <label
        htmlFor={controlId}
        className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300"
      >
        {label}
        {required ? (
          <span className="ml-1 text-danger-500" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {/* 错误态描边通过后代选择器联动内部控件，页面侧无需手动传 error class */}
      <div
        className={
          hasError
            ? '[&_input]:border-danger-400 [&_select]:border-danger-400 [&_textarea]:border-danger-400 dark:[&_input]:border-danger-500 dark:[&_select]:border-danger-500 dark:[&_textarea]:border-danger-500 [&_input:focus]:border-danger-500 [&_input:focus]:ring-danger-500/30 [&_select:focus]:border-danger-500 [&_textarea:focus]:border-danger-500'
            : undefined
        }
      >
        {enhancedChildren}
      </div>
      {hasError ? (
        <p id={messageId} role="alert" className="mt-1.5 text-xs text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1.5 text-xs text-surface-500 dark:text-surface-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
