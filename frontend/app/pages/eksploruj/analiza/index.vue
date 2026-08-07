<template>
  <div class="pa-4">
    <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-4">
      <div>
        <h1 class="text-h5">Analizy</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Wspólna praca nad konkretną sprawą: graf powiązań, notatki i podmioty,
          których nie ma jeszcze w bazie.
        </p>
      </div>
      <v-btn
        color="primary"
        :prepend-icon="mdiPlus"
        data-testid="analysis-new"
        @click="newDialog = true"
      >
        Nowa analiza
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" density="compact" class="mb-4">
      {{ error }}
    </v-alert>

    <v-progress-linear v-if="pending" indeterminate />

    <v-alert
      v-else-if="!analyses.length"
      type="info"
      variant="tonal"
      data-testid="analysis-empty"
    >
      Nie masz jeszcze żadnej analizy. Załóż pierwszą - albo poproś kogoś, żeby
      udostępnił Ci swoją.
    </v-alert>

    <v-row v-else>
      <v-col
        v-for="analysis in analyses"
        :key="analysis.id"
        cols="12"
        md="6"
        lg="4"
      >
        <v-card
          :to="`/eksploruj/analiza/${analysis.id}`"
          data-testid="analysis-card"
        >
          <v-card-item>
            <v-card-title class="text-wrap">{{ analysis.title }}</v-card-title>
            <v-card-subtitle>
              {{ analysis.entities?.length ?? 0 }}
              {{ entitiesPlural(analysis.entities?.length ?? 0) }} &middot;
              {{ analysis.edges?.length ?? 0 }}
              {{ relationsPlural(analysis.edges?.length ?? 0) }}
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <p v-if="analysis.description" class="text-body-2 mb-2">
              {{ analysis.description }}
            </p>
            <div class="text-caption text-medium-emphasis">
              Zmieniona {{ formatDate(analysis.updatedAt) }}
              <template v-if="(analysis.memberUids?.length ?? 1) > 1">
                &middot; udostępniona {{ analysis.memberUids.length - 1 }}
                {{ peoplePlural(analysis.memberUids.length - 1) }}
              </template>
            </div>
          </v-card-text>
          <v-card-actions v-if="canDelete(analysis)">
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              color="error"
              data-testid="analysis-delete"
              @click.prevent="confirmDelete = analysis.id ?? null"
            >
              Usuń
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="newDialog" max-width="480">
      <v-card title="Nowa analiza">
        <v-card-text>
          <v-text-field
            v-model="title"
            label="Czego dotyczy?"
            autofocus
            data-testid="analysis-new-title"
            @keyup.enter="create"
          />
          <v-textarea
            v-model="description"
            label="Krótki opis (opcjonalnie)"
            rows="2"
            auto-grow
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="newDialog = false">Anuluj</v-btn>
          <v-btn
            color="primary"
            :disabled="!title.trim()"
            :loading="creating"
            data-testid="analysis-new-save"
            @click="create"
          >
            Utwórz
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!confirmDelete" max-width="420">
      <v-card title="Usunąć analizę?">
        <v-card-text>
          Zniknie wraz z notatkami i powiązaniami dodanymi w jej trakcie.
          Podmioty i powiązania zgłoszone do bazy zostają.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="confirmDelete = null">Anuluj</v-btn>
          <v-btn
            color="error"
            data-testid="analysis-delete-confirm"
            @click="remove"
          >
            Usuń
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiPlus } from "@mdi/js";
import { useAnalysisList } from "~/composables/analysis";
import { canDeleteAnalysis, type Analysis } from "~~/shared/analysis";
import { relationsPlural } from "~/composables/edges";
import { useAuthState } from "~/composables/auth";

definePageMeta({
  middleware: "auth",
  title: "Analizy",
  robots: false,
});

useHead({ title: "Analizy - koryta.pl" });

const { user, isAdmin } = useAuthState();
const { analyses, pending, createAnalysis, deleteAnalysis } = useAnalysisList();

const newDialog = ref(false);
const title = ref("");
const description = ref("");
const creating = ref(false);
const confirmDelete = ref<string | null>(null);
const error = ref("");

async function create() {
  if (!title.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    const id = await createAnalysis(title.value, description.value);
    newDialog.value = false;
    title.value = "";
    description.value = "";
    await navigateTo(`/eksploruj/analiza/${id}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się utworzyć.";
  } finally {
    creating.value = false;
  }
}

function canDelete(analysis: Analysis) {
  return canDeleteAnalysis(analysis, user.value?.uid, isAdmin.value);
}

async function remove() {
  const id = confirmDelete.value;
  confirmDelete.value = null;
  if (!id) return;
  try {
    await deleteAnalysis(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się usunąć.";
  }
}

function entitiesPlural(count: number): string {
  if (count === 1) return "podmiot";
  const tens = count % 100;
  const units = count % 10;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return "podmioty";
  return "podmiotów";
}

function peoplePlural(count: number): string {
  if (count === 1) return "osobie";
  return "osobom";
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
</script>
