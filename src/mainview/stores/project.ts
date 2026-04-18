import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../rpc";
import type { Project } from "@shared/rpc-types";

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Project[]>([]);
  const loading = ref(false);

  async function loadProjects() {
    loading.value = true;
    try {
      projects.value = await api("projects.list", {});
    } finally {
      loading.value = false;
    }
  }

  async function registerProject(params: {
    workspaceKey: string;
    name: string;
    projectPath: string;
    gitRootPath: string;
    defaultBranch: string;
    slug?: string;
    description?: string;
  }) {
    const project = await api("projects.register", params);
    projects.value.push(project);
    return project;
  }

  return { projects, loading, loadProjects, registerProject };
});
