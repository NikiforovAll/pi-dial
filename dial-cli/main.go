package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

const (
	dialBaseURL = "https://ai-proxy.lab.epam.com"
	cacheFileName = ".dial-cache.json"
)

type Model struct {
	ID                   string                 `json:"id"`
	DisplayName          string                 `json:"display_name"`
	DisplayVersion       string                 `json:"display_version"`
	Description          string                 `json:"description"`
	Capabilities         map[string]interface{} `json:"capabilities"`
	Features             map[string]interface{} `json:"features"`
	InputAttachmentTypes []string               `json:"input_attachment_types"`
	Limits               map[string]interface{} `json:"limits"`
	Defaults             map[string]interface{} `json:"defaults"`
	Pricing              map[string]string      `json:"pricing"`
	LifecycleStatus      string                 `json:"lifecycle_status"`
	TokenizerModel       string                 `json:"tokenizer_model"`
}

type ModelsResponse struct {
	Data []Model `json:"data"`
}

type LimitsResponse struct {
	MinuteTokenStats  TokenStats `json:"minuteTokenStats"`
	DayTokenStats     TokenStats `json:"dayTokenStats"`
	WeekTokenStats    TokenStats `json:"weekTokenStats"`
	MonthTokenStats   TokenStats `json:"monthTokenStats"`
	HourRequestStats  TokenStats `json:"hourRequestStats"`
	DayRequestStats   TokenStats `json:"dayRequestStats"`
	MinuteCostStats   TokenStats `json:"minuteCostStats"`
	DayCostStats      TokenStats `json:"dayCostStats"`
	WeekCostStats     TokenStats `json:"weekCostStats"`
	MonthCostStats    TokenStats `json:"monthCostStats"`
}

type TokenStats struct {
	Total float64 `json:"total"`
	Used  float64 `json:"used"`
}

type CacheEntry struct {
	Models    []Model   `json:"models"`
	Timestamp time.Time `json:"timestamp"`
}

var (
	jsonOutput bool
	filter     string
	showAll    bool
	catalog    bool
)

var rootCmd = &cobra.Command{
	Use:   "dial",
	Short: "CLI for DIAL AI API",
	Long:  "A CLI tool to interact with EPAM's DIAL AI proxy service.",
}

var modelsCmd = &cobra.Command{
	Use:   "models <model_id> [limits]",
	Short: "Model commands",
	Long:  "List models, view model details, or check limits. Use 'list' for the catalog, '<model_id>' for details, or '<model_id> limits' for quota info.",
	Args:  cobra.ArbitraryArgs,
	RunE:  getModelsDetailHandler,
}

func getModelsDetailHandler(cmd *cobra.Command, args []string) error {
	apiKey := os.Getenv("DIAL_API_KEY")
	if apiKey == "" {
		return fmt.Errorf("DIAL_API_KEY environment variable not set")
	}

	// If no arguments, show help
	if len(args) == 0 {
		return cmd.Help()
	}

	modelID := args[0]

	if len(args) > 1 && args[1] == "limits" {
		limits, err := fetchLimits(apiKey, modelID)
		if err != nil {
			return err
		}

		if jsonOutput {
			encoder := json.NewEncoder(os.Stdout)
			encoder.SetIndent("", "  ")
			return encoder.Encode(limits)
		}

		return outputLimitsTable(modelID, limits)
	}

	model, err := fetchModelDetails(apiKey, modelID)
	if err != nil {
		return err
	}

	if jsonOutput {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(model)
	}

	return outputModelDetails(modelID, *model)
}

var modelsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List models (cached available by default)",
	Long:  "List models. By default shows cached available models (those your key can use). Use --catalog to fetch from API, --refresh to bypass cache.",
	RunE: func(cmd *cobra.Command, args []string) error {
		apiKey := os.Getenv("DIAL_API_KEY")
		if apiKey == "" {
			return fmt.Errorf("DIAL_API_KEY environment variable not set")
		}

		var models []Model
		var err error

		if catalog {
			models, err = fetchModels(apiKey)
			if err != nil {
				return err
			}
		} else {
			models, err = getCachedOrFetchAvailable(apiKey)
			if err != nil {
				return err
			}
		}

		if filter != "" {
			filterLower := strings.ToLower(filter)
			var filtered []Model
			for _, m := range models {
				if strings.Contains(strings.ToLower(m.ID), filterLower) ||
					strings.Contains(strings.ToLower(m.DisplayName), filterLower) {
					filtered = append(filtered, m)
				}
			}
			models = filtered
			if len(models) == 0 {
				fmt.Fprintln(os.Stderr, "No models found matching filter:", filter)
				return nil
			}
		}

		if jsonOutput {
			return outputJSON(models)
		}

		if !catalog {
			fmt.Printf("Showing %d available models (cached). Use --catalog for full catalog.\n\n", len(models))
		}
		return outputTable(models)
	},
}

var modelsRefreshCmd = &cobra.Command{
	Use:   "refresh",
	Short: "Refresh cache of available models",
	Long:  "Check limits for all models and cache which ones are available for your API key. Run this when you get new model access.",
	RunE: func(cmd *cobra.Command, args []string) error {
		apiKey := os.Getenv("DIAL_API_KEY")
		if apiKey == "" {
			return fmt.Errorf("DIAL_API_KEY environment variable not set")
		}

		fmt.Println("Fetching models and checking access...")
		available, err := fetchAvailableModels(apiKey)
		if err != nil {
			return err
		}

		if err := saveCache(available); err != nil {
			return fmt.Errorf("failed to save cache: %w", err)
		}

		fmt.Printf("Cache updated: %d models available for your API key.\n", len(available))
		return nil
	},
}

var modelsLimitsCmd = &cobra.Command{
	Use:   "limits <model_id>",
	Short: "Get rate limits for a specific model",
	Long:  "Fetch token, request, and cost limits for a model. minuteTokenStats.total=0 means no access.",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		apiKey := os.Getenv("DIAL_API_KEY")
		if apiKey == "" {
			return fmt.Errorf("DIAL_API_KEY environment variable not set")
		}

		modelID := args[0]
		limits, err := fetchLimits(apiKey, modelID)
		if err != nil {
			return err
		}

		if jsonOutput {
			encoder := json.NewEncoder(os.Stdout)
			encoder.SetIndent("", "  ")
			return encoder.Encode(limits)
		}

		return outputLimitsTable(modelID, limits)
	},
}

func getCachePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, cacheFileName)
}

func loadCache() (*CacheEntry, error) {
	path := getCachePath()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var entry CacheEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		return nil, err
	}

	// Cache never expires - use 'dial models refresh' to update
	return &entry, nil
}

func saveCache(models []Model) error {
	entry := CacheEntry{
		Models:    models,
		Timestamp: time.Now(),
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}

	return os.WriteFile(getCachePath(), data, 0600)
}

func getCachedOrFetchAvailable(apiKey string) ([]Model, error) {
	cache, err := loadCache()
	if err == nil {
		return cache.Models, nil
	}

	fmt.Fprintln(os.Stderr, "No cache found. Fetching available models...")
	available, err := fetchAvailableModels(apiKey)
	if err != nil {
		return nil, err
	}

	if err := saveCache(available); err != nil {
		fmt.Fprintln(os.Stderr, "Warning: failed to save cache:", err)
	}

	return available, nil
}

func fetchAvailableModels(apiKey string) ([]Model, error) {
	allModels, err := fetchModels(apiKey)
	if err != nil {
		return nil, err
	}

	var available []Model
	checked := 0
	total := len(allModels)

	for _, model := range allModels {
		checked++
		if checked%10 == 0 {
			fmt.Fprintf(os.Stderr, "\rChecking model %d/%d...", checked, total)
		}

		limits, err := fetchLimits(apiKey, model.ID)
		if err != nil {
			continue
		}

		if limits.MinuteTokenStats.Total > 0 {
			available = append(available, model)
		}
	}
	fmt.Fprintln(os.Stderr, "\rDone checking models. Found", len(available), "available.")

	return available, nil
}

func fetchModels(apiKey string) ([]Model, error) {
	req, err := http.NewRequest("GET", dialBaseURL+"/openai/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Api-Key", apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("unauthorized: invalid API key")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result ModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Data, nil
}

func fetchModelDetails(apiKey, modelID string) (*Model, error) {
	models, err := fetchModels(apiKey)
	if err != nil {
		return nil, err
	}

	for i := range models {
		if models[i].ID == modelID {
			return &models[i], nil
		}
	}
	return nil, fmt.Errorf("model '%s' not found in catalog", modelID)
}

func fetchLimits(apiKey, modelID string) (*LimitsResponse, error) {
	url := fmt.Sprintf("%s/v1/deployments/%s/limits", dialBaseURL, modelID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Api-Key", apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch limits: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("unauthorized: invalid API key")
	}
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("model '%s' not found or no access", modelID)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result LimitsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

func getBool(m map[string]interface{}, key string) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func formatNumber(n float64) string {
	if n >= 1e9 {
		return fmt.Sprintf("%.1fB", n/1e9)
	}
	if n >= 1e6 {
		return fmt.Sprintf("%.1fM", n/1e6)
	}
	if n >= 1e3 {
		return fmt.Sprintf("%.1fK", n/1e3)
	}
	return fmt.Sprintf("%.0f", n)
}

func outputJSON(models []Model) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if showAll {
		return encoder.Encode(models)
	}

	type minimalModel struct {
		ID              string            `json:"id"`
		DisplayName     string            `json:"display_name"`
		LifecycleStatus string            `json:"lifecycle_status"`
		Pricing         map[string]string `json:"pricing,omitempty"`
		ChatCompletion  bool              `json:"chat_completion"`
		Tools           bool              `json:"tools"`
		AutoCaching     bool              `json:"auto_caching"`
	}

	var minimal []minimalModel
	for _, m := range models {
		minimal = append(minimal, minimalModel{
			ID:              m.ID,
			DisplayName:     m.DisplayName,
			LifecycleStatus: m.LifecycleStatus,
			Pricing:         m.Pricing,
			ChatCompletion:  getBool(m.Capabilities, "chat_completion"),
			Tools:           getBool(m.Features, "tools"),
			AutoCaching:     getBool(m.Features, "auto_caching"),
		})
	}
	return encoder.Encode(minimal)
}

func outputTable(models []Model) error {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)

	if showAll {
		fmt.Fprintln(w, "ID\tDISPLAY NAME\tSTATUS\tCHAT\tTOOLS\tPRICING (INPUT/OUTPUT)")
		for _, m := range models {
			chat := "no"
			tools := "no"
			if getBool(m.Capabilities, "chat_completion") {
				chat = "yes"
			}
			if getBool(m.Features, "tools") {
				tools = "yes"
			}
			pricing := "-"
			if m.Pricing != nil {
				pricing = fmt.Sprintf("%s / %s", m.Pricing["prompt"], m.Pricing["completion"])
			}
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
				m.ID, m.DisplayName, m.LifecycleStatus, chat, tools, pricing)
		}
	} else {
		fmt.Fprintln(w, "ID\tDISPLAY NAME\tSTATUS")
		for _, m := range models {
			fmt.Fprintf(w, "%s\t%s\t%s\n", m.ID, m.DisplayName, m.LifecycleStatus)
		}
	}

	return w.Flush()
}

func outputLimitsTable(modelID string, limits *LimitsResponse) error {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)

	fmt.Fprintf(w, "Rate limits for: %s\n\n", modelID)

	if limits.MinuteTokenStats.Total == 0 {
		fmt.Fprintln(w, "STATUS: No access (minuteTokenStats.total = 0)")
		fmt.Fprintln(w, "The API key cannot use this model.")
		return w.Flush()
	}

	fmt.Fprintln(w, "=== TOKEN QUOTAS ===")
	fmt.Fprintln(w, "WINDOW\t\tTOTAL\t\tUSED\t\tREMAINING")
	printStats(w, "Minute", limits.MinuteTokenStats)
	printStats(w, "Day", limits.DayTokenStats)
	printStats(w, "Week", limits.WeekTokenStats)
	printStats(w, "Month", limits.MonthTokenStats)

	fmt.Fprintln(w, "\n=== REQUEST QUOTAS ===")
	fmt.Fprintln(w, "WINDOW\t\tTOTAL\t\tUSED")
	printStats(w, "Hour", limits.HourRequestStats)
	printStats(w, "Day", limits.DayRequestStats)

	if limits.DayCostStats.Total > 0 && limits.DayCostStats.Total < 9223372036854775807 {
		fmt.Fprintln(w, "\n=== COST TRACKING ===")
		fmt.Fprintln(w, "WINDOW\t\tTOTAL\t\tUSED")
		if limits.MinuteCostStats.Total < 9223372036854775807 {
			printStats(w, "Minute", limits.MinuteCostStats)
		}
		printStats(w, "Day", limits.DayCostStats)
		printStats(w, "Week", limits.WeekCostStats)
		printStats(w, "Month", limits.MonthCostStats)
	}

	return w.Flush()
}

func printStats(w *tabwriter.Writer, label string, stats TokenStats) {
	total := formatNumber(stats.Total)
	used := formatNumber(stats.Used)
	remaining := formatNumber(stats.Total - stats.Used)
	if stats.Total == 0 || stats.Total >= 9223372036854770000 {
		fmt.Fprintf(w, "%s\t\t%s\t\t%s\t\t%s\n", label, "unlimited", used, "unlimited")
	} else {
		fmt.Fprintf(w, "%s\t\t%s\t\t%s\t\t%s\n", label, total, used, remaining)
	}
}

func outputModelDetails(modelID string, model Model) error {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)

	fmt.Fprintf(w, "ID:\t%s\n", model.ID)
	fmt.Fprintf(w, "Name:\t%s\n", model.DisplayName)
	if model.DisplayVersion != "" {
		fmt.Fprintf(w, "Version:\t%s\n", model.DisplayVersion)
	}
	fmt.Fprintf(w, "Status:\t%s\n", model.LifecycleStatus)
	if model.TokenizerModel != "" {
		fmt.Fprintf(w, "Tokenizer:\t%s\n", model.TokenizerModel)
	}

	if model.Description != "" {
		fmt.Fprintf(w, "\nDESCRIPTION\n%s\n", model.Description)
	}

	fmt.Fprintf(w, "\nCAPABILITIES\n")
	for k, v := range model.Capabilities {
		if b, ok := v.(bool); ok {
			if b {
				fmt.Fprintf(w, "  • %s\n", k)
			}
		} else {
			fmt.Fprintf(w, "  • %s: %v\n", k, v)
		}
	}

	fmt.Fprintf(w, "\nFEATURES\n")
	for k, v := range model.Features {
		if b, ok := v.(bool); ok {
			if b {
				fmt.Fprintf(w, "  • %s\n", k)
			}
		} else {
			fmt.Fprintf(w, "  • %s: %v\n", k, v)
		}
	}

	if model.Pricing != nil {
		fmt.Fprintf(w, "\nPRICING\n")
		fmt.Fprintf(w, "  Prompt:\t%s\n", model.Pricing["prompt"])
		fmt.Fprintf(w, "  Completion:\t%s\n", model.Pricing["completion"])
		fmt.Fprintf(w, "  Unit:\t%s\n", model.Pricing["unit"])
	}

	if len(model.Limits) > 0 {
		fmt.Fprintf(w, "\nCONTEXT LIMITS\n")
		for k, v := range model.Limits {
			fmt.Fprintf(w, "  %s:\t%v\n", k, v)
		}
	}

	return w.Flush()
}

func init() {
	rootCmd.PersistentFlags().BoolVar(&jsonOutput, "json", false, "Output in JSON format")

	modelsCmd.PersistentFlags().BoolVar(&showAll, "all", false, "Show all metadata fields")

	modelsListCmd.Flags().StringVar(&filter, "filter", "", "Filter models by partial match on ID or display name")
	modelsListCmd.Flags().BoolVar(&catalog, "catalog", false, "Show full catalog (not just available models)")

	modelsCmd.AddCommand(modelsListCmd)
	modelsCmd.AddCommand(modelsRefreshCmd)
	rootCmd.AddCommand(modelsCmd)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
