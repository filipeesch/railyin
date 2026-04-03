import { defineStore } from "pinia";
import { ref } from "vue";
import { electroview } from "../rpc";
import type { Project } from "@shared/rpc-types";

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Project[]>([]);
  const loading = ref(false);

  async function loadProjects() {
    loading.value = true;
    try {
      projects.value = await electroview.rpc.request["projects.list"]({});
    } finally {
      loading.value = false;
    }
  }

  async function registerProject(params: {
    name: string;
    projectPath: string;
    gitRootPath: string;
    defaultBranch: string;
    slug?: string;
    description?: string;
  }) {
    const project = await electroview.rpc.request["projects.register"](params);
    projects.value.push(project);
    return project;
  }

  return { projects, loading, loadProjects, registerProject };
});
