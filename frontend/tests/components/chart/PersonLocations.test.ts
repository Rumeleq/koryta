import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PersonLocations from "../../../app/components/chart/PersonLocations.vue";
import { personLocations } from "../../../app/utils/personLocations";

const mountMap = async (
  elections: { location?: string; teryt?: string }[],
  work: { name: string; teryt?: string }[],
) =>
  await mountSuspended(PersonLocations, {
    props: { locations: personLocations(elections, work) },
  });

const powiat = (wrapper: Awaited<ReturnType<typeof mountMap>>, teryt: string) =>
  wrapper.find(`path[data-teryt="${teryt}"]`);

describe("ChartPersonLocations", () => {
  it("draws every powiat, whether or not the person touches it", async () => {
    const wrapper = await mountMap([{ location: "Kraków", teryt: "1261" }], []);
    expect(wrapper.findAll("path[data-teryt]").length).toBe(380);
    expect(powiat(wrapper, "0201").classes()).toEqual(["powiat"]);
  });

  it("colours the powiat someone stood for election in", async () => {
    const wrapper = await mountMap([{ location: "Kraków", teryt: "1261" }], []);
    expect(powiat(wrapper, "1261").classes()).toContain("powiat--election");
    expect(powiat(wrapper, "1261").find("title").text()).toBe("Kraków");
  });

  it("colours a whole województwo an employer is seated in", async () => {
    const wrapper = await mountMap(
      [],
      [{ name: "Województwo Pomorskie", teryt: "22" }],
    );
    expect(powiat(wrapper, "2261").classes()).toContain("powiat--work");
    expect(powiat(wrapper, "2211").classes()).toContain("powiat--work");
    expect(powiat(wrapper, "1261").classes()).not.toContain("powiat--work");
  });

  it("draws a place that is both as both", async () => {
    const wrapper = await mountMap(
      [{ location: "Kraków", teryt: "1261" }],
      [{ name: "Województwo Małopolskie", teryt: "12" }],
    );
    expect(powiat(wrapper, "1261").classes()).toContain("powiat--both");
  });

  it("says which places it could not draw", async () => {
    const wrapper = await mountMap([{ location: "Bruksela" }], []);
    expect(wrapper.text()).toContain("Bruksela");
    expect(wrapper.text()).toContain("nie mamy dla nich kodu TERYT");
  });
});
