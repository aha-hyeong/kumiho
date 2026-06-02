import { beforeEach, describe, expect, it } from "vitest";
import { useEpubViewerStore, normalizeEpubLineHeightScale } from "./epubViewerStore";

describe("normalizeEpubLineHeightScale", () => {
  it("새 배율 범위 내의 값은 그대로 유지한다", () => {
    expect(normalizeEpubLineHeightScale(0.75)).toBe(0.75);
    expect(normalizeEpubLineHeightScale(1.0)).toBe(1.0);
    expect(normalizeEpubLineHeightScale(1.2)).toBe(1.2);
    expect(normalizeEpubLineHeightScale(1.25)).toBe(1.25);
  });

  it("기존 절대 줄 간격(> 1.25 및 <= 2.0)을 새 배율 범위로 변환한다", () => {
    expect(normalizeEpubLineHeightScale(1.6)).toBe(1.0);
    expect(normalizeEpubLineHeightScale(2.0)).toBe(1.25);
  });
});

describe("epubViewerStore series settings", () => {
  beforeEach(() => {
    useEpubViewerStore.getState().reset();
    useEpubViewerStore.setState({ seriesSettings: {}, currentSeriesId: null });
  });

  it("currentSeriesId가 설정되지 않으면 seriesSettings에 저장하지 않는다", () => {
    const store = useEpubViewerStore.getState();
    store.setTheme("dark");
    expect(useEpubViewerStore.getState().seriesSettings).toEqual({});
  });

  it("currentSeriesId가 설정된 경우 설정 변경 시 seriesSettings에 저장한다", () => {
    const store = useEpubViewerStore.getState();
    store.setCurrentSeriesId("series-1");
    store.setTheme("dark");
    expect(useEpubViewerStore.getState().seriesSettings["series-1"]).toMatchObject({
      theme: "dark",
    });
  });

  it("같은 시리즈에서 여러 설정을 변경하면 누적된다", () => {
    const store = useEpubViewerStore.getState();
    store.setCurrentSeriesId("series-2");
    store.setTheme("sepia");
    store.setFontSize(120);
    store.setFlow("scrolled");
    expect(useEpubViewerStore.getState().seriesSettings["series-2"]).toEqual({
      theme: "sepia",
      fontSize: 120,
      flow: "scrolled",
    });
  });

  it("다른 시리즈의 설정은 서로 격리된다", () => {
    const store = useEpubViewerStore.getState();
    store.setCurrentSeriesId("series-a");
    store.setTheme("dark");
    store.setCurrentSeriesId("series-b");
    store.setTheme("light");
    expect(useEpubViewerStore.getState().seriesSettings["series-a"]).toEqual({ theme: "dark" });
    expect(useEpubViewerStore.getState().seriesSettings["series-b"]).toEqual({ theme: "light" });
  });

  it("updateSeriesSetting으로 직접 시리즈 설정을 업데이트할 수 있다", () => {
    const store = useEpubViewerStore.getState();
    store.updateSeriesSetting("series-3", { fontFamily: "serif", lineHeight: 1.1 });
    expect(useEpubViewerStore.getState().seriesSettings["series-3"]).toEqual({
      fontFamily: "serif",
      lineHeight: 1.1,
    });
  });

  it("reset은 seriesSettings를 초기화하지 않는다", () => {
    const store = useEpubViewerStore.getState();
    store.setCurrentSeriesId("series-1");
    store.setTheme("dark");
    store.reset();
    expect(useEpubViewerStore.getState().seriesSettings["series-1"]).toEqual({ theme: "dark" });
  });

  it("seriesSettings 개수가 50개를 초과하면 가장 오래된(처음 추가된) 설정을 삭제한다", () => {
    const store = useEpubViewerStore.getState();
    for (let i = 1; i <= 51; i++) {
      store.updateSeriesSetting(`series-${i}`, { theme: "dark" });
    }
    const settings = useEpubViewerStore.getState().seriesSettings;
    expect(Object.keys(settings).length).toBe(50);
    expect(settings["series-1"]).toBeUndefined();
    expect(settings["series-51"]).toEqual({ theme: "dark" });
  });

  it("buildSettingUpdate (setter 호출) 시에도 seriesSettings 개수가 50개를 초과하면 eviction이 작동한다", () => {
    const store = useEpubViewerStore.getState();
    for (let i = 1; i <= 50; i++) {
      store.updateSeriesSetting(`series-${i}`, { theme: "light" });
    }
    store.setCurrentSeriesId("series-51");
    store.setTheme("dark");

    const settings = useEpubViewerStore.getState().seriesSettings;
    expect(Object.keys(settings).length).toBe(50);
    expect(settings["series-1"]).toBeUndefined();
    expect(settings["series-51"]).toEqual({ theme: "dark" });
  });
});
