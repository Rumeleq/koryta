import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { useCurrentUser } from "vuefire";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import AddRelation from "../../../app/components/form/AddRelation.vue";

const vuetify = createVuetify({ components, directives });

const EditEdgeStub = {
  name: "FormEditEdge",
  props: ["nodeId", "nodeType", "nodeName", "edgeTypeExt", "initialDirection"],
  emits: ["update"],
  template: '<div class="edit-edge-stub" />',
};

function mountAddRelation(props: Record<string, unknown> = {}) {
  return mount(AddRelation, {
    props: {
      nodeId: "jan",
      nodeType: "person",
      nodeName: "Jan Kowalski",
      types: ["connection", "employed"],
      ...props,
    },
    global: {
      plugins: [vuetify],
      stubs: { FormEditEdge: EditEdgeStub },
    },
  });
}

function signedIn(inState: boolean) {
  vi.mocked(useCurrentUser).mockReturnValue(
    ref(inState ? { uid: "u1" } : null) as ReturnType<typeof useCurrentUser>,
  );
}

describe("AddRelation.vue", () => {
  beforeEach(() => {
    signedIn(true);
  });

  it("asks a logged out reader to sign in rather than showing a dead form", () => {
    signedIn(false);
    const wrapper = mountAddRelation();

    expect(wrapper.find('[data-testid="add-relation-login"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="edge-picker-connection"]').exists(),
    ).toBe(false);
  });

  it("offers exactly the relations it was told to", () => {
    const wrapper = mountAddRelation();

    expect(
      wrapper.find('[data-testid="edge-picker-connection"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="edge-picker-employed"]').exists()).toBe(
      true,
    );
    // A candidacy comes from the PKW pipeline, not from a reader.
    expect(wrapper.find('[data-testid="edge-picker-election"]').exists()).toBe(
      false,
    );
  });

  it("opens the form on the relation that was picked", async () => {
    const wrapper = mountAddRelation();
    expect(wrapper.findComponent(EditEdgeStub).exists()).toBe(false);

    await wrapper.find('[data-testid="edge-picker-employed"]').trigger("click");

    const form = wrapper.findComponent(EditEdgeStub);
    expect(form.exists()).toBe(true);
    expect(form.props()).toMatchObject({
      nodeId: "jan",
      edgeTypeExt: "employed",
      initialDirection: "outgoing",
    });
  });

  it("tells the page to refetch once a relation is written", async () => {
    const wrapper = mountAddRelation();
    await wrapper
      .find('[data-testid="edge-picker-connection"]')
      .trigger("click");

    wrapper.findComponent(EditEdgeStub).vm.$emit("update", true);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("added")).toBeTruthy();
    expect(wrapper.find('[data-testid="add-relation-success"]').exists()).toBe(
      true,
    );
    // Back to the picker, ready for the next one.
    expect(wrapper.findComponent(EditEdgeStub).exists()).toBe(false);
  });

  it("says nothing was added when the form was only closed", async () => {
    const wrapper = mountAddRelation();
    await wrapper
      .find('[data-testid="edge-picker-connection"]')
      .trigger("click");

    wrapper.findComponent(EditEdgeStub).vm.$emit("update", false);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("added")).toBeFalsy();
    expect(wrapper.find('[data-testid="add-relation-success"]').exists()).toBe(
      false,
    );
    expect(wrapper.findComponent(EditEdgeStub).exists()).toBe(false);
  });
});
