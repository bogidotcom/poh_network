<script setup>
import { ref } from 'vue'
import LandingPage from './components/LandingPage.vue'
import HumanPower from './components/HumanPower.vue'
import SkillsPage from './components/SkillsPage.vue'

const currentView = ref('landing')

function navigate(view) {
  currentView.value = view
}
</script>

<template>
  <div class="layout">
    <LandingPage v-if="currentView === 'landing'" @navigate="navigate" />
    <HumanPower v-else-if="currentView === 'scanner'" @navigate="navigate" />
    <SkillsPage v-else-if="currentView === 'skills'" @navigate="navigate" />
  </div>
</template>

<style scoped>
.layout {
  min-height: 100vh;
}
</style>
