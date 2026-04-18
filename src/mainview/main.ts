import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import "primeicons/primeicons.css";
import "@xterm/xterm/css/xterm.css";
import App from "./App.vue";
import router from "./router";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: ".dark-mode",
      cssLayer: false,
    },
  },
  zIndex: {
    overlay: 1300,
    menu: 1300,
    modal: 1100,
    tooltip: 1100,
  },
});
app.use(ToastService);
app.use(ConfirmationService);

app.mount("#app");
