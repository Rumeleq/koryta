<template>
  <div class="pa-4">
    <div class="d-flex align-start flex-wrap ga-4 mb-6">
      <div class="flex-grow-1">
        <h1 class="text-h4 mb-1">Rady nadzorcze szpitali publicznych</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Szpital prowadzony jako spółka ma radę nadzorczą, a zasiadanie w niej
          jest co do zasady odpłatne. Pokazujemy, z jakich partii są ludzie,
          którzy zajmują te miejsca — i dlaczego nie liczymy tu rad społecznych.
        </p>
      </div>
      <v-btn
        to="/eksploruj/statystyki"
        color="primary"
        variant="tonal"
        :prepend-icon="mdiArrowRight"
      >
        Statystyki bazy
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      text="Nie udało się pobrać danych o radach nadzorczych szpitali."
    />

    <v-alert
      v-else-if="empty"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      text="Nie mamy jeszcze w bazie ani jednego miejsca w organie nadzoru szpitala publicznego. Liczby szpitali poniżej są prawdziwe, podziału na partie jeszcze nie ma."
    />

    <!-- ------------------------------------------------------------------ -->
    <h2 class="text-h6 mb-3">W skrócie</h2>

    <v-card variant="outlined" class="mb-4">
      <v-card-text>
        <v-skeleton-loader v-if="!stats" type="heading, text" />
        <div v-else class="d-flex flex-wrap ga-8">
          <StatsStatTile
            v-for="tile in headlineTiles"
            :key="tile.label"
            v-bind="tile"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-card variant="outlined" class="mb-6">
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-medium">
          Czym są nadzorowane szpitale publiczne
        </v-card-title>
        <v-card-subtitle class="text-wrap">
          „Brak organu w KRS” to nie to samo co rada nadzorcza — rada społeczna
          powstaje z ustawy i często nie trafia do rejestru.
        </v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-skeleton-loader v-if="!stats" type="text@2" />
        <StatsCompositionBar
          v-else
          :segments="segments"
          summary="Podział szpitali publicznych według organu nadzoru wpisanego do KRS"
        />
      </v-card-text>
    </v-card>

    <!-- ------------------------------------------------------------------ -->
    <!-- The exclusion, stated before the breakdown it applies to, because it
         is the one thing a reader has to understand to read the numbers below.
         It also has to be prominent for a second reason: a rada społeczna is
         the body actually filled with radni and officials, so a reader who
         notices it was dropped and finds no explanation would reasonably read
         the omission as cherry-picking rather than as the fairness choice it
         is. -->
    <v-alert
      type="info"
      variant="tonal"
      density="comfortable"
      class="mb-4"
      :icon="mdiScaleBalance"
    >
      <p class="mb-2">
        <strong>Rada społeczna to nie rada nadzorcza.</strong> Rada społeczna
        jest organem opiniodawczo-doradczym samodzielnego publicznego zakładu
        opieki zdrowotnej. Ustawa o działalności leczniczej nie przewiduje dla
        jej członków ani wynagrodzenia, ani diety — jedynie rekompensatę
        utraconych zarobków, jeżeli pracodawca udzielił członkowi na czas
        posiedzenia bezpłatnego zwolnienia z obowiązków pracowniczych (art. 48
        ust. 9-10). Dlatego tych miejsc nie wliczamy do zestawienia.
      </p>
      <p class="mb-0">
        {{ exclusionSummary }} Przełącznik poniżej pokazuje, co dokładnie
        zostało wyłączone.
      </p>
    </v-alert>

    <div class="d-flex align-center flex-wrap ga-3 mb-1">
      <h2 class="text-h6 mb-0">Podział na partie</h2>
      <v-spacer />
      <!-- One control, above everything it scopes: the chart and the list of
           hospitals below it change together. -->
      <v-btn-toggle
        v-model="group"
        density="compact"
        variant="outlined"
        divided
        mandatory
      >
        <v-btn
          v-for="value in boardGroups"
          :key="value"
          :value="value"
          size="small"
        >
          {{ boardGroupShortLabels[value] }}
        </v-btn>
      </v-btn-toggle>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-3">
      {{ boardGroupLabels[group] }}
    </p>

    <v-row class="mb-2">
      <v-col cols="12">
        <StatsHospitalPartySeats
          :title="chartTitle"
          :subtitle="chartSubtitle"
          :rows="partyRows"
          :loading="pending"
          :empty-text="emptyText"
        />
      </v-col>
    </v-row>

    <v-row class="mb-6">
      <v-col cols="12">
        <StatsHospitalBoardTable
          :title="tableTitle"
          :subtitle="tableSubtitle"
          :rows="hospitalRows"
          :loading="pending"
          :empty-text="emptyText"
        />
      </v-col>
    </v-row>

    <!-- ------------------------------------------------------------------ -->
    <h2 class="text-h6 mb-3">Jak liczymy</h2>

    <v-card variant="outlined" class="mb-4">
      <v-card-text class="text-body-2">
        <p class="mb-3">
          Bierzemy pod uwagę wyłącznie szpitale, o których KRS mówi, że należą
          do sektora publicznego, i wyłącznie osoby, które nasza baza wiąże z
          organem nadzoru takiego szpitala. Do zestawienia płatnych miejsc
          wchodzi tylko rada nadzorcza — organ spółki prawa handlowego, któremu
          zgromadzenie wspólników może uchwałą przyznać wynagrodzenie (art.
          222<sup>1</sup> § 1 Kodeksu spółek handlowych), w granicach limitu z
          ustawy z 9 czerwca 2016 r. o zasadach kształtowania wynagrodzeń osób
          kierujących niektórymi spółkami.
        </p>

        <p class="mb-1">Nie uwzględniamy:</p>
        <ul class="mb-3 ms-6">
          <li>
            rad społecznych samodzielnych publicznych zakładów opieki zdrowotnej
            — funkcji pełnionej bez wynagrodzenia;
          </li>
          <li>
            szpitali, przy których KRS nie wpisał żadnego organu nadzoru — brak
            wpisu nie jest dowodem na to, że rada jest płatna;
          </li>
          <li>
            szpitali, których nasze pipeline'y nie odczytały jeszcze z rejestru
            po dodaniu tego pola.
          </li>
        </ul>

        <p class="mb-1">Ograniczenia, o których trzeba wiedzieć:</p>
        <ul class="mb-3 ms-6">
          <li>
            „publiczny” znaczy tu „publiczny na tyle, na ile widać to w KRS”.
            Rejestr nie ujawnia akcjonariuszy spółek akcyjnych poza jedynym
            akcjonariuszem, więc część faktycznie samorządowych szpitali w ogóle
            nam tu nie wychodzi.
          </li>
          <li>
            Wpis w KRS bywa nieaktualny wobec faktycznego składu organu, a
            kadencja rady nadzorczej trwa kilka lat.
          </li>
          <li>
            Przynależność partyjna pochodzi z naszej bazy i opisuje powiązania
            historyczne — nie oznacza, że partia kogokolwiek na to miejsce
            wskazała.
          </li>
          <li>
            Partia jest przypisana tylko części osób, dlatego przy udziałach
            liczymy wyłącznie miejsca, przy których ją znamy, a resztę
            pokazujemy osobno.
          </li>
        </ul>

        <p class="mb-0">
          Nie publikujemy kwot wynagrodzeń. Ustawa z 9 czerwca 2016 r. określa
          jedynie górny limit, a konkretną wysokość ustala uchwała zgromadzenia
          wspólników danej spółki — liczymy miejsca, nie pieniądze.
        </p>
      </v-card-text>
    </v-card>

    <p v-if="stats" class="text-caption text-medium-emphasis">
      Przeliczone {{ formatDaysAgo(stats.generatedAt) }} na podstawie odpisów z
      KRS zebranych w naszej bazie.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiArrowRight, mdiScaleBalance } from "@mdi/js";
import {
  boardGroupLabels,
  boardGroupShortLabels,
  useHospitalBoards,
  type BoardGroup,
} from "~/composables/stats/useHospitalBoards";
import { polishCounting } from "~/composables/polish";
import {
  categorical,
  formatCount,
  formatDaysAgo,
  ink,
} from "~/utils/chartTheme";

useSeoMeta({
  title: "Rady nadzorcze szpitali publicznych - koryta.pl",
  description:
    "Kto zajmuje płatne miejsca w radach nadzorczych szpitali publicznych, w podziale na partie. Rady społeczne, w których zasiada się bez wynagrodzenia, są policzone osobno.",
});

const boardGroups: BoardGroup[] = ["paid", "unpaid"];

const {
  stats,
  pending,
  error,
  group,
  selected,
  partyRows,
  hospitalRows,
  segments,
  empty,
} = await useHospitalBoards();

const headlineTiles = computed(() => {
  const data = stats.value;
  if (!data) return [];
  return [
    {
      label: "Szpitale publiczne w bazie",
      value: data.hospitals,
      hint: "niezależnie od organu nadzoru",
    },
    {
      label: "Z radą nadzorczą",
      value: data.paid.hospitals,
      hint: `${formatCount(data.paid.hospitalsWithSeats)} z obsadą w naszej bazie`,
      color: categorical[0],
    },
    {
      label: "Miejsca w radach nadzorczych",
      value: data.paid.seats,
      hint: `${formatCount(data.paid.seatsWithParty)} z przypisaną partią`,
      color: categorical[0],
    },
    {
      label: "Wykluczone rady społeczne",
      value: data.unpaid.hospitals,
      hint: `${polishCounting(data.unpaid.seats, "miejsce", "miejsca", "miejsc")} bez wynagrodzenia`,
      tooltip:
        "Rada społeczna SPZOZ. Ustawa o działalności leczniczej nie przewiduje za nią wynagrodzenia, więc te miejsca nie wchodzą do podziału na partie.",
      color: categorical[1],
    },
    {
      label: "Reszta szpitali",
      value: data.other.hospitals,
      hint: "brak organu w KRS albo inny organ",
      tooltip:
        "Szpitale, przy których rejestr nie wpisał organu nadzoru, wpisał organ innego rodzaju albo których nie zdążyliśmy jeszcze odczytać. Nie ma dowodu w żadną stronę, więc nie wchodzą do podziału.",
      color: ink.track,
    },
  ];
});

/** Said in the alert above the switch, so the number a reader is asked to
 * accept as excluded is on the page next to the reason for excluding it. */
const exclusionSummary = computed(() => {
  const data = stats.value;
  if (!data) return "";
  return `Poza zestawieniem zostaje ${polishCounting(data.unpaid.seats, "miejsce", "miejsca", "miejsc")} w ${polishCounting(data.unpaid.hospitals, "radzie społecznej", "radach społecznych", "radach społecznych")}.`;
});

const chartTitle = computed(() =>
  group.value === "paid"
    ? "Miejsca w radach nadzorczych według partii"
    : "Miejsca w radach społecznych według partii (nieuwzględnione)",
);

const chartSubtitle = computed(() => {
  const data = selected.value;
  if (!data) return "";
  const base =
    group.value === "paid"
      ? "Miejsca, za które spółka może płacić."
      : "Miejsca bez wynagrodzenia — pokazane, żeby było widać, co wyłączyliśmy.";
  return `${base} Osoba z dwiema partiami liczy się w każdej z nich, dlatego słupki sumują się do więcej niż ${polishCounting(data.seats, "miejsce", "miejsca", "miejsc")}; udziały liczymy wobec ${formatCount(data.seatsWithParty)} miejsc z przypisaną partią.`;
});

const tableTitle = computed(() =>
  group.value === "paid"
    ? "Szpitale z radą nadzorczą"
    : "Szpitale z radą społeczną",
);

const tableSubtitle = computed(() => {
  const data = selected.value;
  if (!data) return "";
  const missing = data.hospitals - data.hospitalsWithSeats;
  // The hospitals with nobody on record are the denominator that stops a party
  // looking clean when it is only unobserved, so the count goes next to the
  // list rather than into a footnote.
  const unobserved =
    missing > 0
      ? ` Przy ${polishCounting(missing, "szpitalu", "szpitalach", "szpitalach")} z tej grupy nie mamy jeszcze w bazie nikogo.`
      : "";
  const ended = data.endedSeats
    ? ` W bazie jest też ${polishCounting(data.endedSeats, "miejsce", "miejsca", "miejsc")} z datą końca — tych nie liczymy.`
    : "";
  return `Wypisujemy ${polishCounting(data.hospitalsWithSeats, "szpital", "szpitale", "szpitali")} z obsadzonym organem.${unobserved}${ended}`;
});

const emptyText = computed(() =>
  group.value === "paid"
    ? "Nie mamy jeszcze w bazie żadnego miejsca w radzie nadzorczej szpitala publicznego."
    : "Nie mamy jeszcze w bazie żadnego miejsca w radzie społecznej.",
);
</script>
