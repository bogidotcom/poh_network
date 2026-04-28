<script setup>
import { ref } from 'vue'
import { Search, PlusSquare, Vote, SquareArrowDown, PersonStanding, FolderCode } from 'lucide-vue-next'
import { useWallet } from '../composables/useWallet.js'

const props = defineProps({ current: String })
const emit  = defineEmits(['navigate'])

const { connected, shortAddress, showWalletModal, disconnectWallet } = useWallet()
const mobileOpen = ref(false)

function go(section, extra) {
  emit('navigate', section, extra)
  mobileOpen.value = false
}
</script>

<template>
  <header class="header">
    <div class="logo" @click="go('landing')">
      <img src="/poh-icon.png" alt="POH" />
    </div>

    <!-- Desktop nav -->
    <nav class="nav desktop-nav">
      <button :class="['nav-btn', { active: current === 'checker'  }]" @click="go('checker')">
        <Search :size="14" class="icon" /> Scan
      </button>
      <button :class="['nav-btn', { active: current === 'listing'  }]" @click="go('listing')">
        <PlusSquare :size="14" class="icon" /> List
      </button>
      <button :class="['nav-btn', { active: current === 'votes'    }]" @click="go('votes', 'load')">
        <Vote :size="14" class="icon" /> Vote
      </button>
      <button :class="['nav-btn', { active: current === 'staking'  }]" @click="go('staking')">
        <SquareArrowDown :size="14" class="icon" /> Stake
      </button>
      <button :class="['nav-btn', { active: current === 'profile'  }]" @click="go('profile', 'load')">
        <PersonStanding :size="14" class="icon" /> Profile
      </button>
      <button :class="['nav-btn', { active: current === 'api'      }]" @click="go('api')">
        <FolderCode :size="14" class="icon" /> API
      </button>
    </nav>

    <div class="header-right">
      <!-- Wallet status -->
      <div class="wallet-wrapper desktop-wallet">
        <button v-if="!connected" class="select-wallet-btn" @click="showWalletModal = true">
          Connect Wallet
        </button>
        <div v-else class="connected-status">
          <div class="status-indicator"></div>
          <span class="address-text">{{ shortAddress }}</span>
          <button class="disconnect-link" @click="disconnectWallet">Disconnect</button>
        </div>
      </div>

      <!-- Hamburger -->
      <button class="hamburger" :class="{ open: mobileOpen }" @click="mobileOpen = !mobileOpen">
        <span /><span /><span />
      </button>
    </div>
  </header>

  <!-- Mobile menu -->
  <div class="mobile-menu" :class="{ open: mobileOpen }" @click.self="mobileOpen = false">
    <div class="mobile-menu-inner">
      <button :class="['mobile-nav-btn', { active: current === 'landing'  }]" @click="go('landing')">POH</button>
      <button :class="['mobile-nav-btn', { active: current === 'checker'  }]" @click="go('checker')">Scan</button>
      <button :class="['mobile-nav-btn', { active: current === 'listing'  }]" @click="go('listing')">List</button>
      <button :class="['mobile-nav-btn', { active: current === 'votes'    }]" @click="go('votes', 'load')">Vote</button>
      <button :class="['mobile-nav-btn', { active: current === 'api'      }]" @click="go('api')">API</button>
      <button :class="['mobile-nav-btn', { active: current === 'staking'  }]" @click="go('staking')">Stake</button>
      <button :class="['mobile-nav-btn', { active: current === 'profile'  }]" @click="go('profile', 'load')">Profile</button>
      <div class="mobile-menu-divider"></div>
      <button v-if="!connected" class="mobile-nav-btn mobile-connect" @click="showWalletModal = true; mobileOpen = false">
        Connect Wallet
      </button>
      <div v-else class="mobile-wallet-status">
        <div class="status-indicator"></div>
        <span class="address-text">{{ shortAddress }}</span>
        <button class="disconnect-link" @click="disconnectWallet(); mobileOpen = false">Disconnect</button>
      </div>
    </div>
  </div>
</template>
