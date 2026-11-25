import Swal from 'sweetalert2';
import { apiErrorMessage } from '../api/client';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3200,
  timerProgressBar: true,
});

export const toast = {
  success: (title) => Toast.fire({ icon: 'success', title }),
  error: (title) => Toast.fire({ icon: 'error', title }),
  info: (title) => Toast.fire({ icon: 'info', title }),
  warning: (title) => Toast.fire({ icon: 'warning', title }),
};

export function showError(error, title = 'Action failed') {
  return Swal.fire({ icon: 'error', title, text: apiErrorMessage(error), customClass: { htmlContainer: 'whitespace-pre-line text-left' } });
}

export function showMessage(title, text, icon = 'warning') {
  return Swal.fire({ icon, title, text });
}

export async function confirmAction({ title, text, confirmText = 'Confirm', danger = false, icon = 'question' }) {
  const res = await Swal.fire({
    icon: danger ? 'warning' : icon,
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'Cancel',
    reverseButtons: true,
    focusCancel: danger,
    ...(danger ? { confirmButtonColor: '#b91c1c' } : {}),
  });
  return res.isConfirmed;
}

/** Asks for a documented reason (corrections, returns, reopening). Resolves to the text or null. */
export async function promptReason({ title, text, confirmText = 'Submit', placeholder = 'State the reason…', minLength = 5, required = true }) {
  const res = await Swal.fire({
    title,
    text,
    input: 'textarea',
    inputPlaceholder: placeholder,
    showCancelButton: true,
    confirmButtonText: confirmText,
    reverseButtons: true,
    inputValidator: (v) => {
      if (!required && !v) return undefined;
      if (!v || v.trim().length < minLength) return `Please enter at least ${minLength} characters.`;
      return undefined;
    },
  });
  return res.isConfirmed ? (res.value || '').trim() : null;
}
