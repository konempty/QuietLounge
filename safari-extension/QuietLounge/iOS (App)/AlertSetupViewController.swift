import UIKit

protocol AlertSetupDelegate: AnyObject {
    func alertSetup(didSave keywords: [String], channelId: String, channelName: String)
}

class AlertSetupViewController: UIViewController {
    weak var delegate: AlertSetupDelegate?

    private enum Step { case category, channel, keyword }
    private var step: Step = .category

    private let qlGreen = UIColor(red: 31/255, green: 175/255, blue: 99/255, alpha: 1)
    private let cardView = UIView()
    private let titleLabel = UILabel()
    private let backButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let searchField = UITextField()
    private let listTable = UITableView()
    private let spinner = UIActivityIndicatorView(style: .medium)

    // keyword step
    private let keywordContainer = UIView()
    private let keywordField = UITextField()
    private let tagFlow = KeywordTagFlowView()
    private let saveButton = UIButton(type: .system)

    private var categories: [(id: Int, name: String)] = []
    private var channels: [(id: String, name: String)] = []
    private var filteredItems: [(id: String, name: String)] = []
    private var selectedCategoryId: Int?
    private var selectedChannelId: String?
    private var selectedChannelName: String?
    private var keywords: [String] = []

    init() {
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overCurrentContext
        modalTransitionStyle = .crossDissolve
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.6)

        let bgTap = UITapGestureRecognizer(target: self, action: #selector(bgTapped(_:)))
        bgTap.delegate = self
        view.addGestureRecognizer(bgTap)

        setupCard()
        showStep(.category)
        loadCategories()
    }

    // MARK: - Card Layout

    private func setupCard() {
        let cardBg = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.12, alpha: 1) : .white }
        cardView.backgroundColor = cardBg
        cardView.layer.cornerRadius = 16
        cardView.clipsToBounds = true
        cardView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cardView)

        // header
        backButton.setTitle("← 뒤로", for: .normal)
        backButton.setTitleColor(.secondaryLabel, for: .normal)
        backButton.titleLabel?.font = .systemFont(ofSize: 13)
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)

        titleLabel.font = .systemFont(ofSize: 16, weight: .bold)

        closeButton.setTitle("✕", for: .normal)
        closeButton.setTitleColor(.secondaryLabel, for: .normal)
        closeButton.titleLabel?.font = .systemFont(ofSize: 20)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        let headerRow = UIStackView(arrangedSubviews: [backButton, titleLabel, closeButton])
        headerRow.alignment = .center
        headerRow.distribution = .equalSpacing
        headerRow.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(headerRow)

        // search
        searchField.placeholder = "검색..."
        searchField.borderStyle = .roundedRect
        searchField.font = .systemFont(ofSize: 14)
        searchField.autocorrectionType = .no
        searchField.clearButtonMode = .whileEditing
        searchField.addTarget(self, action: #selector(searchChanged), for: .editingChanged)
        searchField.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(searchField)

        // list
        listTable.dataSource = self
        listTable.delegate = self
        listTable.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        listTable.backgroundColor = .clear
        listTable.separatorInset = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        listTable.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(listTable)

        // spinner
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(spinner)

        // keyword container
        setupKeywordContainer()

        NSLayoutConstraint.activate([
            cardView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            cardView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            cardView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            cardView.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.7),

            headerRow.topAnchor.constraint(equalTo: cardView.topAnchor, constant: 16),
            headerRow.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 16),
            headerRow.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -16),

            searchField.topAnchor.constraint(equalTo: headerRow.bottomAnchor, constant: 10),
            searchField.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 16),
            searchField.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -16),

            listTable.topAnchor.constraint(equalTo: searchField.bottomAnchor, constant: 8),
            listTable.leadingAnchor.constraint(equalTo: cardView.leadingAnchor),
            listTable.trailingAnchor.constraint(equalTo: cardView.trailingAnchor),
            listTable.bottomAnchor.constraint(equalTo: cardView.bottomAnchor),

            spinner.centerXAnchor.constraint(equalTo: listTable.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: listTable.centerYAnchor),

            keywordContainer.topAnchor.constraint(equalTo: searchField.topAnchor),
            keywordContainer.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 16),
            keywordContainer.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -16),
            keywordContainer.bottomAnchor.constraint(equalTo: cardView.bottomAnchor, constant: -16)
        ])
    }

    private func setupKeywordContainer() {
        keywordContainer.translatesAutoresizingMaskIntoConstraints = false
        keywordContainer.isHidden = true
        cardView.addSubview(keywordContainer)

        let inputRow = UIStackView()
        inputRow.axis = .horizontal
        inputRow.spacing = 8

        keywordField.placeholder = "키워드 입력 후 Enter"
        keywordField.borderStyle = .roundedRect
        keywordField.font = .systemFont(ofSize: 15)
        keywordField.returnKeyType = .done
        keywordField.autocorrectionType = .no
        keywordField.delegate = self

        var addCfg = UIButton.Configuration.filled()
        addCfg.title = "추가"
        addCfg.baseBackgroundColor = qlGreen
        addCfg.baseForegroundColor = .white
        addCfg.cornerStyle = .medium
        addCfg.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)
        let addBtn = UIButton(configuration: addCfg)
        addBtn.addTarget(self, action: #selector(addKeywordTapped), for: .touchUpInside)

        inputRow.addArrangedSubview(keywordField)
        inputRow.addArrangedSubview(addBtn)
        keywordField.setContentHuggingPriority(.defaultLow, for: .horizontal)
        addBtn.setContentHuggingPriority(.required, for: .horizontal)
        addBtn.setContentCompressionResistancePriority(.required, for: .horizontal)

        var saveCfg = UIButton.Configuration.filled()
        saveCfg.title = "등록"
        saveCfg.baseBackgroundColor = qlGreen
        saveCfg.baseForegroundColor = .white
        saveCfg.cornerStyle = .large
        saveCfg.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 0, bottom: 12, trailing: 0)
        saveButton.configuration = saveCfg
        saveButton.isEnabled = false
        saveButton.addTarget(self, action: #selector(saveTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [inputRow, tagFlow, saveButton])
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        keywordContainer.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: keywordContainer.topAnchor),
            stack.leadingAnchor.constraint(equalTo: keywordContainer.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: keywordContainer.trailingAnchor),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: keywordContainer.bottomAnchor)
        ])
    }

    // MARK: - Step Transitions

    private func showStep(_ newStep: Step) {
        step = newStep
        searchField.text = ""
        searchField.resignFirstResponder()

        switch step {
        case .category:
            titleLabel.text = "카테고리 선택"
            backButton.isHidden = true
            searchField.isHidden = false
            searchField.placeholder = "카테고리 검색..."
            listTable.isHidden = false
            keywordContainer.isHidden = true
        case .channel:
            titleLabel.text = "채널 선택"
            backButton.isHidden = false
            searchField.isHidden = false
            searchField.placeholder = "채널 검색..."
            listTable.isHidden = false
            keywordContainer.isHidden = true
        case .keyword:
            titleLabel.text = selectedChannelName ?? ""
            titleLabel.textColor = qlGreen
            backButton.isHidden = false
            searchField.isHidden = true
            listTable.isHidden = true
            keywordContainer.isHidden = false
            keywordField.becomeFirstResponder()
        }
        listTable.reloadData()
    }

    // MARK: - Networking

    private func loadCategories() {
        spinner.startAnimating()
        Task {
            let url = URL(string: "https://api.lounge.naver.com/content-api/v1/categories?depth=2")!
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let dataObj = json["data"] as? [String: Any],
                  let items = dataObj["items"] as? [[String: Any]] else {
                await MainActor.run { spinner.stopAnimating() }
                return
            }
            let cats = items.compactMap { item -> (Int, String)? in
                guard let name = item["name"] as? String,
                      let catId = item["categoryId"] as? Int else { return nil }
                return (catId, name)
            }
            await MainActor.run {
                categories = cats
                filteredItems = cats.map { (String($0.0), $0.1) }
                spinner.stopAnimating()
                listTable.reloadData()
            }
        }
    }

    private func loadChannels(categoryId: Int) {
        spinner.startAnimating()
        filteredItems = []
        listTable.reloadData()
        Task {
            var all: [(String, String)] = []
            var page = 1
            var hasMore = true
            while hasMore {
                let url = URL(string: "https://api.lounge.naver.com/content-api/v1/channels?categoryId=\(categoryId)&page=\(page)&size=50")!
                guard let (data, _) = try? await URLSession.shared.data(from: url),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let dataObj = json["data"] as? [String: Any],
                      let items = dataObj["items"] as? [[String: Any]] else { break }
                for ch in items {
                    if let name = ch["name"] as? String,
                       let chId = ch["finalChannelId"] as? String { all.append((chId, name)) }
                }
                let total = (dataObj["page"] as? [String: Any])?["totalElements"] as? Int ?? 0
                if page * 50 >= total { hasMore = false } else { page += 1 }
            }
            await MainActor.run {
                channels = all
                filteredItems = all
                spinner.stopAnimating()
                listTable.reloadData()
            }
        }
    }

    // MARK: - Actions

    @objc private func backTapped() {
        switch step {
        case .channel:
            filteredItems = categories.map { (String($0.0), $0.1) }
            showStep(.category)
        case .keyword:
            keywords = []
            updateKeywordUI()
            filteredItems = channels
            showStep(.channel)
        case .category:
            break
        }
    }

    @objc private func closeTapped() { dismiss(animated: true) }

    @objc private func bgTapped(_ gesture: UITapGestureRecognizer) {
        if !cardView.frame.contains(gesture.location(in: view)) { dismiss(animated: true) }
    }

    @objc private func searchChanged() {
        let query = (searchField.text ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        switch step {
        case .category:
            filteredItems = query.isEmpty
                ? categories.map { (String($0.0), $0.1) }
                : categories.filter { $0.1.lowercased().contains(query) }.map { (String($0.0), $0.1) }
        case .channel:
            filteredItems = query.isEmpty ? channels : channels.filter { $0.1.lowercased().contains(query) }
        case .keyword:
            break
        }
        listTable.reloadData()
    }

    @objc private func addKeywordTapped() { addCurrentKeyword() }

    @objc private func saveTapped() {
        guard let chId = selectedChannelId, let chName = selectedChannelName else { return }
        delegate?.alertSetup(didSave: keywords, channelId: chId, channelName: chName)
        dismiss(animated: true)
    }

    private func addCurrentKeyword() {
        guard let text = keywordField.text?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return }
        if !keywords.contains(text) { keywords.append(text) }
        keywordField.text = ""
        updateKeywordUI()
    }

    private func updateKeywordUI() {
        tagFlow.configureRemovable(with: keywords) { [weak self] idx in
            self?.keywords.remove(at: idx)
            self?.updateKeywordUI()
        }
        saveButton.isEnabled = !keywords.isEmpty
        saveButton.alpha = keywords.isEmpty ? 0.4 : 1.0
    }
}

// MARK: - UITableViewDataSource / Delegate

extension AlertSetupViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { filteredItems.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var cfg = cell.defaultContentConfiguration()
        cfg.text = filteredItems[indexPath.row].name
        cfg.textProperties.font = .systemFont(ofSize: 14)
        cell.contentConfiguration = cfg
        cell.backgroundColor = .clear
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let item = filteredItems[indexPath.row]
        switch step {
        case .category:
            selectedCategoryId = Int(item.id)
            loadChannels(categoryId: Int(item.id)!)
            showStep(.channel)
        case .channel:
            selectedChannelId = item.id
            selectedChannelName = item.name
            showStep(.keyword)
        case .keyword:
            break
        }
    }
}

extension AlertSetupViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        if step == .keyword { addCurrentKeyword() }
        return false
    }
}

extension AlertSetupViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        !cardView.frame.contains(touch.location(in: view))
    }
}
