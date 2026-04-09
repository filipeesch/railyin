import { ref, watch } from "vue";

const STORAGE_KEY = "railyn-dark-mode";
const DARK_CLASS = "dark-mode";

const isDark = ref<boolean>(localStorage.getItem(STORAGE_KEY) === "true");

function apply(dark: boolean) {
  if (dark) {
    document.documentElement.classList.add(DARK_CLASS);
  } else {
    document.documentElement.classList.remove(DARK_CLASS);
  }
}

// Apply on initial load
apply(isDark.value);

watch(isDark, (val) => {
  apply(val);
  localStorage.setItem(STORAGE_KEY, String(val));
});

export function useDarkMode() {
  function toggle() {
    isDark.value = !isDark.value;
  }

  return { isDark, toggle };
}
