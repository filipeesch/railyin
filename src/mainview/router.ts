import { createRouter, createWebHistory } from "vue-router";
import BoardView from "./views/BoardView.vue";
import SetupView from "./views/SetupView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/board" },
    { path: "/board", component: BoardView },
    { path: "/setup", component: SetupView },
  ],
});

export default router;
