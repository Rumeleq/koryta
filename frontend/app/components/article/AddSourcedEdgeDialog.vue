<template>
  <v-dialog v-model="open" max-width="620" scrollable>
    <v-card data-testid="add-sourced-edge-dialog">
      <v-card-title class="pb-1">Dodaj powiązanie z tego źródła</v-card-title>
      <v-card-subtitle class="pb-3 text-wrap">
        Źródłem będzie: <strong>{{ articleName }}</strong>
      </v-card-subtitle>

      <v-card-text class="pt-0">
        <FormEntityPicker
          v-model="from"
          :entity="endpointTypes"
          label="Kogo dotyczy"
          density="comfortable"
          hide-details="auto"
          autofocus
          class="mb-3"
          data-testid="sourced-edge-from"
        />
        <FormEntityPicker
          v-model="to"
          :entity="endpointTypes"
          label="Z kim lub z czym"
          density="comfortable"
          hide-details="auto"
          data-testid="sourced-edge-to"
        />

        <template v-if="from && to">
          <div class="d-flex align-center flex-wrap ga-2 mt-4 mb-2">
            <span class="text-caption text-medium-emphasis">
              Rodzaj powiązania:
            </span>
            <span class="text-body-2">
              <strong>{{ from.name }}</strong>
              <v-icon :icon="mdiArrowRight" size="small" class="mx-1" />
              <strong>{{ to.name }}</strong>
            </span>
          </div>

          <v-chip-group
            v-model="choiceIndex"
            selected-class="text-primary"
            mandatory
            column
            data-testid="sourced-edge-verbs"
          >
            <v-chip
              v-for="(candidate, index) in choices"
              :key="candidate.edgeTypeExt + '-' + candidate.direction"
              :value="index"
              filter
              variant="tonal"
              :data-testid="`sourced-edge-verb-${candidate.edgeTypeExt}`"
            >
              {{ candidate.verb }}
            </v-chip>
          </v-chip-group>

          <v-alert
            v-if="choices.length === 0"
            type="info"
            variant="tonal"
            density="compact"
            class="mt-2"
            data-testid="sourced-edge-no-verbs"
          >
            Nie ma powiązania, które łączyłoby te dwie strony.
          </v-alert>

          <v-row v-if="choice" dense class="mt-1">
            <v-col cols="12" md="6">
              <v-text-field
                v-model="details.name"
                :label="nameLabel"
                :placeholder="namePlaceholder"
                density="compact"
                hide-details
                data-testid="sourced-edge-name"
              />
            </v-col>
            <template v-if="wantsDates">
              <v-col cols="6" md="3">
                <v-text-field
                  v-model="details.start_date"
                  label="Od"
                  placeholder="RRRR-MM-DD"
                  density="compact"
                  hide-details="auto"
                  :rules="[dateRule]"
                />
              </v-col>
              <v-col cols="6" md="3">
                <v-text-field
                  v-model="details.end_date"
                  label="Do"
                  placeholder="RRRR-MM-DD"
                  density="compact"
                  hide-details="auto"
                  :rules="[dateRule]"
                />
              </v-col>
            </template>
          </v-row>
        </template>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="sourced-edge-error"
        >
          {{ error }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="open = false">
          Anuluj
        </v-btn>
        <v-btn
          color="success"
          variant="tonal"
          :loading="saving"
          :disabled="!readyToSubmit"
          data-testid="sourced-edge-submit"
          @click="submit()"
        >
          Dodaj powiązanie
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** Writes a relation between two other entities, cited to the article the page
 * is on.
 *
 * `FormAddRelationDialog` cannot do this: it assumes the page you opened it
 * from is one end of the relation, and here the article is neither end - it is
 * the source. So both ends are picked, and `references` is filled in rather
 * than offered.
 */
import { computed, ref, watch } from "vue";
import { mdiArrowRight } from "@mdi/js";
import type { Link, NodeType } from "~~/shared/model";
import { edgeTypeOptions, relationChoices } from "~/composables/useEdgeTypes";
import { authRequest } from "~/composables/auth";

const props = defineProps<{
  modelValue: boolean;
  articleId: string;
  articleName: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  added: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

/** What a cited relation can join. Articles and topics are left out on purpose:
 * an article's own `mentions` are added from the article itself, and a topic is
 * joined by tagging rather than by a relation that needs a source. */
const endpointTypes: NodeType[] = ["person", "place", "region"];

const from = ref<Link<NodeType> | undefined>(undefined);
const to = ref<Link<NodeType> | undefined>(undefined);
const choiceIndex = ref<number | undefined>(undefined);
const saving = ref(false);
const error = ref<string | null>(null);
const details = ref({ name: "", start_date: "", end_date: "" });

const choices = computed(() =>
  from.value && to.value ? relationChoices(from.value.type, to.value.type) : [],
);

const choice = computed(() =>
  choiceIndex.value === undefined
    ? undefined
    : choices.value[choiceIndex.value],
);

const option = computed(() =>
  choice.value ? edgeTypeOptions[choice.value.edgeTypeExt] : undefined,
);

const wantsDates = computed(
  () =>
    option.value?.realType === "employed" ||
    option.value?.realType === "election",
);

const nameLabel = computed(() => {
  if (option.value?.realType === "employed") return "Stanowisko / rola";
  if (option.value?.realType === "election") return "Nazwa wyborów";
  return "Nazwa powiązania";
});

const namePlaceholder = computed(() =>
  option.value?.realType === "employed" ? "np. prezes zarządu" : "",
);

function dateRule(value: string) {
  if (!value) return true;
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) || "Format: RRRR-MM-DD";
}

const readyToSubmit = computed(
  () =>
    !!from.value &&
    !!to.value &&
    !!choice.value &&
    from.value.id !== to.value.id &&
    dateRule(details.value.start_date) === true &&
    dateRule(details.value.end_date) === true,
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  from.value = undefined;
  to.value = undefined;
  choiceIndex.value = undefined;
  error.value = null;
  details.value = { name: "", start_date: "", end_date: "" };
});

// Either end changing can change which verbs apply, and an index into the old
// list means something else in the new one.
watch([from, to], () => {
  choiceIndex.value = choices.value.length > 0 ? 0 : undefined;
});

async function submit() {
  if (!readyToSubmit.value || saving.value) return;
  const picked = choice.value!;
  // `relationChoices` reads the verb with `from` as the subject, so an
  // "incoming" choice means the pair is stored the other way round.
  const outgoing = picked.direction === "outgoing";

  saving.value = true;
  error.value = null;
  try {
    await authRequest<{ id: string }>("/api/edges/create", {
      method: "POST",
      body: {
        source: outgoing ? from.value!.id : to.value!.id,
        target: outgoing ? to.value!.id : from.value!.id,
        type: edgeTypeOptions[picked.edgeTypeExt].realType,
        name: details.value.name,
        start_date: details.value.start_date,
        end_date: details.value.end_date,
        references: [props.articleId],
      },
    });
    emit("added");
    open.value = false;
  } catch (e: unknown) {
    const data = (e as { data?: { message?: string } } | null)?.data;
    error.value =
      data?.message ||
      (e instanceof Error ? e.message : "") ||
      "Nie udało się zapisać powiązania.";
  } finally {
    saving.value = false;
  }
}
</script>
