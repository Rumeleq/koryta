<template>
  <v-dialog v-model="open" max-width="560">
    <v-card title="Udostępnianie analizy">
      <v-card-text>
        <p class="text-body-2 mb-4">
          Osoby z listy zobaczą cały graf, notatki i powiązania dodane w tej
          analizie. Administratorzy koryta.pl mają dostęp do wszystkich analiz.
        </p>

        <v-alert v-if="error" type="error" density="compact" class="mb-3">
          {{ error }}
        </v-alert>

        <div v-if="editable" class="d-flex ga-2 align-start mb-4">
          <v-text-field
            v-model="email"
            label="Adres e-mail"
            density="compact"
            hide-details
            data-testid="analysis-share-email"
            @keyup.enter="share"
          />
          <v-select
            v-model="role"
            :items="roleItems"
            density="compact"
            hide-details
            style="max-width: 190px"
            data-testid="analysis-share-role"
          />
          <v-btn
            color="primary"
            :disabled="!email.trim()"
            :loading="saving"
            data-testid="analysis-share-submit"
            @click="share"
          >
            Udostępnij
          </v-btn>
        </div>

        <v-progress-linear v-if="membersPending" indeterminate class="mb-2" />

        <v-list density="compact" class="py-0">
          <v-list-item
            v-for="member in members"
            :key="member.uid"
            data-testid="analysis-member-row"
          >
            <template #prepend>
              <v-avatar size="32" :image="member.photoURL ?? undefined">
                <v-icon v-if="!member.photoURL" :icon="mdiAccountOutline" />
              </v-avatar>
            </template>

            <v-list-item-title>
              {{ member.displayName || member.email || member.uid }}
            </v-list-item-title>
            <v-list-item-subtitle>
              {{
                member.isOwner ? "Właściciel" : analysisRoleLabel[member.role]
              }}
            </v-list-item-subtitle>

            <template #append>
              <v-btn
                v-if="editable && !member.isOwner"
                :icon="mdiClose"
                size="x-small"
                variant="text"
                title="Odbierz dostęp"
                @click="unshare(member.uid)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="open = false">Zamknij</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { mdiAccountOutline, mdiClose } from "@mdi/js";
import { analysisRoleLabel, type AnalysisRole } from "~~/shared/analysis";
import { useAnalysisContext } from "~/composables/analysis";

const open = defineModel<boolean>({ required: true });

const analysis = useAnalysisContext();
const { members, membersPending, editable } = analysis;

const email = ref("");
const role = ref<AnalysisRole>("editor");
const saving = ref(false);
const error = ref("");

const roleItems = (
  Object.entries(analysisRoleLabel) as [AnalysisRole, string][]
).map(([value, title]) => ({ value, title }));

// Only fetched when the dialog is opened: the list needs a round trip per
// member to resolve a uid into a name, and the page itself never shows them.
watch(open, (isOpen) => {
  if (isOpen) analysis.refreshMembers();
});

async function share() {
  saving.value = true;
  error.value = "";
  try {
    await analysis.shareWith(email.value, role.value);
    email.value = "";
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function unshare(uid: string) {
  error.value = "";
  try {
    await analysis.unshare(uid);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

/** What the server said went wrong - "nie ma użytkownika o adresie ..." is the
 * whole point of showing this, and it only reaches the client in `data`. */
function errorMessage(e: unknown): string {
  const data =
    typeof e === "object" && e !== null
      ? (e as { data?: { message?: string; statusMessage?: string } }).data
      : undefined;
  return (
    data?.message ||
    data?.statusMessage ||
    (e instanceof Error ? e.message : "") ||
    "Nie udało się zmienić dostępu."
  );
}
</script>
